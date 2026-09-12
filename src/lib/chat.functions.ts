import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Liste des projets et conversations du compte connecté. */
export const listWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [projects, conversations] = await Promise.all([
      context.supabase
        .from("projects")
        .select("id, name, created_at")
        .order("created_at", { ascending: true }),
      context.supabase
        .from("conversations")
        .select("id, title, project_id, updated_at")
        .order("updated_at", { ascending: false })
        .limit(200),
    ]);
    if (projects.error) throw new Error(projects.error.message);
    if (conversations.error) throw new Error(conversations.error.message);
    return { projects: projects.data ?? [], conversations: conversations.data ?? [] };
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ name: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    const row = await context.supabase
      .from("projects")
      .insert({ name: data.name, user_id: context.userId })
      .select("id, name, created_at")
      .single();
    if (row.error) throw new Error(row.error.message);
    return row.data;
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const res = await context.supabase.from("projects").delete().eq("id", data.id);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });

export const createConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        title: z.string().min(1).max(120).default("Nouvelle conversation"),
        projectId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const row = await context.supabase
      .from("conversations")
      .insert({
        user_id: context.userId,
        title: data.title,
        project_id: data.projectId ?? null,
      })
      .select("id, title, project_id, updated_at")
      .single();
    if (row.error) throw new Error(row.error.message);
    return row.data;
  });

export const renameConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), title: z.string().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const res = await context.supabase
      .from("conversations")
      .update({ title: data.title })
      .eq("id", data.id);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const res = await context.supabase.from("conversations").delete().eq("id", data.id);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });

/** Messages d'une conversation appartenant au compte connecté (RLS appliquée). */
export const loadConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const conversation = await context.supabase
      .from("conversations")
      .select("id, title, project_id")
      .eq("id", data.id)
      .maybeSingle();
    if (conversation.error) throw new Error(conversation.error.message);
    if (!conversation.data) throw new Error("Conversation introuvable pour ce compte.");

    const messages = await context.supabase
      .from("messages")
      .select("id, role, parts, created_at")
      .eq("conversation_id", data.id)
      .order("created_at", { ascending: true });
    if (messages.error) throw new Error(messages.error.message);

    return {
      conversation: conversation.data,
      // `parts` est renvoyé en JSON sérialisé puis ré-hydraté côté client.
      messages: (messages.data ?? []).map((row) => ({
        id: row.id as string,
        role: row.role as "user" | "assistant",
        partsJson: JSON.stringify(row.parts ?? []),
      })),
    };
  });
