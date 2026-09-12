import type { ToolSet } from "ai";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type McpServerRow = {
  id: string;
  name: string;
  url: string;
  transport: string;
  active: boolean;
  last_error: string | null;
  tool_names: string[];
};

type McpClient = { tools: () => Promise<ToolSet>; close: () => Promise<void> };

/** Ouvre une connexion réelle vers un serveur MCP distant. */
async function openClient(url: string, transport: string): Promise<McpClient> {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Seules les URL http(s) sont acceptées");
  const { createMCPClient } = (await import("@ai-sdk/mcp")) as unknown as {
    createMCPClient: (options: unknown) => Promise<McpClient>;
  };
  return createMCPClient({
    transport:
      transport === "sse"
        ? { type: "sse", url: parsed.toString() }
        : { type: "http", url: parsed.toString(), redirect: "error" },
  });
}

/** Vérifie un serveur MCP et mémorise les outils qu'il expose. */
export async function probeMcpServer(server: McpServerRow) {
  let client: McpClient | undefined;
  try {
    client = await openClient(server.url, server.transport);
    const tools = await client.tools();
    const names = Object.keys(tools);
    await supabaseAdmin
      .from("mcp_servers")
      .update({ tool_names: names, last_error: null })
      .eq("id", server.id);
    return { ok: true as const, toolNames: names };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabaseAdmin.from("mcp_servers").update({ last_error: message }).eq("id", server.id);
    return { ok: false as const, error: message };
  } finally {
    await client?.close().catch(() => undefined);
  }
}

/**
 * Charge les outils de tous les serveurs MCP actifs.
 * Retourne aussi une fonction de fermeture à appeler à la fin du flux.
 */
export async function loadMcpTools(): Promise<{ tools: ToolSet; close: () => Promise<void> }> {
  const rows = await supabaseAdmin
    .from("mcp_servers")
    .select("id, name, url, transport, active, last_error, tool_names")
    .eq("active", true)
    .limit(10);

  const clients: McpClient[] = [];
  const tools: ToolSet = {};
  for (const server of (rows.data ?? []) as McpServerRow[]) {
    try {
      const client = await openClient(server.url, server.transport);
      clients.push(client);
      const remote = await client.tools();
      const prefix = server.name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 24) || "mcp";
      for (const [name, definition] of Object.entries(remote)) {
        tools[`${prefix}_${name}`.slice(0, 60)] = definition;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabaseAdmin.from("mcp_servers").update({ last_error: message }).eq("id", server.id);
    }
  }

  return {
    tools,
    close: async () => {
      await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
    },
  };
}
