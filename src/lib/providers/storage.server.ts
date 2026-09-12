import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BUCKET = "media";
const SIGNED_URL_TTL = 60 * 60 * 24 * 365; // 1 an

export type StoredAsset = {
  id: string;
  kind: string;
  url: string;
  path: string;
  mimeType: string;
  provider: string;
  bytes: number;
  fileName: string;
};

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/pdf": "pdf",
  "text/html": "html",
};

/** Persist a generated media file and return a long-lived signed URL. */
export async function storeAsset(params: {
  kind: string;
  data: Uint8Array;
  mimeType: string;
  provider: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
  fileName?: string;
}): Promise<StoredAsset> {
  const ext = EXT[params.mimeType] ?? "bin";
  const safeName = params.fileName?.replace(/[^a-zA-Z0-9._-]/g, "_");
  const name = safeName ?? `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const path = `${params.kind}/${name}`;

  const upload = await supabaseAdmin.storage.from(BUCKET).upload(path, params.data, {
    contentType: params.mimeType,
    upsert: true,
  });
  if (upload.error) throw new Error(`Échec de l'enregistrement du fichier : ${upload.error.message}`);

  const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (signed.error || !signed.data) {
    throw new Error(`Échec de la création du lien de téléchargement : ${signed.error?.message}`);
  }

  const row = await supabaseAdmin
    .from("media_assets")
    .insert({
      kind: params.kind,
      storage_path: path,
      mime_type: params.mimeType,
      provider: params.provider,
      prompt: params.prompt ?? null,
      metadata: (params.metadata ?? {}) as never,
    })
    .select("id")
    .single();

  return {
    id: row.data?.id ?? path,
    kind: params.kind,
    url: signed.data.signedUrl,
    path,
    mimeType: params.mimeType,
    provider: params.provider,
    bytes: params.data.byteLength,
    fileName: name,
  };
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
