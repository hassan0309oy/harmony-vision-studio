import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MAX = 120 * 1024 * 1024;

const TicketInput = z.object({
  name: z.string().min(1).max(300),
  size: z.number().int().positive(),
  mimeType: z.string().max(200).default("application/octet-stream"),
  conversationId: z.string().uuid().nullable().optional(),
});

/** Crée une entrée de pièce jointe + une URL d'envoi signée (envoi direct au stockage). */
export const createUploadTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TicketInput.parse(input))
  .handler(async ({ data, context }) => {
    if (data.size > MAX) {
      throw new Error(
        `Fichier trop volumineux : ${(data.size / 1048576).toFixed(1)} Mo. La limite est de 120 Mo.`,
      );
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ATTACHMENT_BUCKET, safeFileName } = await import("./providers/attachments.server");

    const path = `${context.userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeFileName(data.name)}`;
    const signed = await supabaseAdmin.storage.from(ATTACHMENT_BUCKET).createSignedUploadUrl(path);
    if (signed.error || !signed.data) {
      throw new Error(`Envoi impossible : ${signed.error?.message ?? "stockage indisponible"}`);
    }

    const row = await supabaseAdmin
      .from("attachments")
      .insert({
        user_id: context.userId,
        conversation_id: data.conversationId ?? null,
        name: data.name,
        size: data.size,
        mime_type: data.mimeType || "application/octet-stream",
        storage_path: path,
        status: "uploading",
      })
      .select("id")
      .single();
    if (row.error) throw new Error(row.error.message);

    return {
      attachmentId: row.data.id as string,
      uploadUrl: signed.data.signedUrl,
      token: signed.data.token,
      path,
    };
  });

/** Confirme la présence réelle du fichier dans le stockage après l'envoi. */
export const finalizeUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ attachmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ATTACHMENT_BUCKET } = await import("./providers/attachments.server");

    const row = await supabaseAdmin
      .from("attachments")
      .select("id, storage_path, name, size, mime_type")
      .eq("id", data.attachmentId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (row.error) throw new Error(row.error.message);
    if (!row.data) throw new Error("Pièce jointe introuvable pour ce compte.");

    const folder = row.data.storage_path.split("/").slice(0, -1).join("/");
    const fileName = row.data.storage_path.split("/").pop()!;
    const listed = await supabaseAdmin.storage
      .from(ATTACHMENT_BUCKET)
      .list(folder, { search: fileName, limit: 1 });
    const found = listed.data?.find((entry) => entry.name === fileName);
    if (!found) {
      await supabaseAdmin
        .from("attachments")
        .update({ status: "failed" })
        .eq("id", data.attachmentId);
      throw new Error("Le fichier n'a pas été reçu par le stockage.");
    }

    await supabaseAdmin
      .from("attachments")
      .update({ status: "ready" })
      .eq("id", data.attachmentId);

    return {
      id: row.data.id as string,
      name: row.data.name as string,
      size: row.data.size as number,
      mimeType: row.data.mime_type as string,
    };
  });
