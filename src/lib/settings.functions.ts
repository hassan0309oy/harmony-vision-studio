import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const PrefInput = z.object({
  key: z.enum(["provider_image", "provider_video", "provider_audio", "provider_memory", "chat_model"]),
  value: z.string().min(1).max(120),
});

const McpInput = z.object({
  name: z.string().min(1).max(60),
  url: z.string().url(),
  transport: z.enum(["http", "sse"]).default("http"),
});

/** Réglages actuels : préférences de fournisseurs + serveurs MCP. */
export const getSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { readPreferences } = await import("./providers/settings.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [preferences, servers] = await Promise.all([
    readPreferences(),
    supabaseAdmin
      .from("mcp_servers")
      .select("id, name, url, transport, active, last_error, tool_names")
      .order("created_at", { ascending: true }),
  ]);
  return { preferences, mcpServers: servers.data ?? [] };
});

export const savePreference = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => PrefInput.parse(input))
  .handler(async ({ data }) => {
    const { writePreference } = await import("./providers/settings.server");
    return writePreference(data.key, data.value);
  });

export const addMcpServer = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => McpInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { probeMcpServer } = await import("./providers/mcp.server");
    const row = await supabaseAdmin
      .from("mcp_servers")
      .insert({ name: data.name, url: data.url, transport: data.transport })
      .select("id, name, url, transport, active, last_error, tool_names")
      .single();
    if (row.error || !row.data) throw new Error(row.error?.message ?? "Insertion impossible");
    const probe = await probeMcpServer(row.data);
    return { server: row.data, probe };
  });

export const testMcpServer = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { probeMcpServer } = await import("./providers/mcp.server");
    const row = await supabaseAdmin
      .from("mcp_servers")
      .select("id, name, url, transport, active, last_error, tool_names")
      .eq("id", data.id)
      .single();
    if (row.error || !row.data) throw new Error(row.error?.message ?? "Serveur introuvable");
    return probeMcpServer(row.data);
  });

export const toggleMcpServer = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), active: z.boolean() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await supabaseAdmin
      .from("mcp_servers")
      .update({ active: data.active })
      .eq("id", data.id);
    if (res.error) throw new Error(res.error.message);
    return { id: data.id, active: data.active };
  });

export const removeMcpServer = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await supabaseAdmin.from("mcp_servers").delete().eq("id", data.id);
    if (res.error) throw new Error(res.error.message);
    return { id: data.id };
  });
