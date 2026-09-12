import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { optionalEnv, requireEnv } from "./errors.server";

const INDEX = "deerflow-memory";
const DIM = 1536;

/** Embeddings via la passerelle Lovable (aucune clé supplémentaire à fournir). */
async function embed(text: string): Promise<number[]> {
  const key = requireEnv("LOVABLE_API_KEY", "la mémoire persistante");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  if (!res.ok) throw new Error(`Embedding [${res.status}] ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  const vec = data.data?.[0]?.embedding;
  if (!vec) throw new Error("Aucun embedding renvoyé");
  return vec;
}

async function pineconeHost(apiKey: string): Promise<string> {
  const headers = { "Api-Key": apiKey, "X-Pinecone-API-Version": "2025-01-01" };
  const describe = await fetch(`https://api.pinecone.io/indexes/${INDEX}`, { headers });
  if (describe.ok) {
    const info = (await describe.json()) as { host?: string; status?: { ready?: boolean } };
    if (info.host) return info.host;
  }
  const created = await fetch("https://api.pinecone.io/indexes", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: INDEX,
      dimension: DIM,
      metric: "cosine",
      spec: { serverless: { cloud: "aws", region: "us-east-1" } },
    }),
  });
  if (!created.ok && created.status !== 409) {
    throw new Error(`Pinecone [${created.status}] ${(await created.text()).slice(0, 300)}`);
  }
  for (let i = 0; i < 30; i++) {
    const d = await fetch(`https://api.pinecone.io/indexes/${INDEX}`, { headers });
    if (d.ok) {
      const info = (await d.json()) as { host?: string; status?: { ready?: boolean } };
      if (info.host && info.status?.ready) return info.host;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Pinecone : l'index n'est pas prêt");
}

export type MemoryRecord = { id: string; content: string; tags: string[]; score?: number };

export async function rememberFact(params: {
  content: string;
  tags?: string[];
  sessionId?: string;
  importance?: number;
}): Promise<{ id: string; vectorStore: string }> {
  const vector = await embed(params.content);
  const row = await supabaseAdmin
    .from("memories")
    .insert({
      content: params.content,
      tags: params.tags ?? [],
      session_id: params.sessionId ?? "default",
      importance: params.importance ?? 1,
    })
    .select("id")
    .single();
  if (row.error || !row.data) throw new Error(`Enregistrement du souvenir échoué : ${row.error?.message}`);

  let vectorStore = "postgres";
  const pineconeKey = optionalEnv("PINECONE_API_KEY");
  if (pineconeKey) {
    try {
      const host = await pineconeHost(pineconeKey);
      const up = await fetch(`https://${host}/vectors/upsert`, {
        method: "POST",
        headers: { "Api-Key": pineconeKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          vectors: [
            {
              id: row.data.id,
              values: vector,
              metadata: { content: params.content, tags: params.tags ?? [] },
            },
          ],
        }),
      });
      if (up.ok) {
        vectorStore = "pinecone";
        await supabaseAdmin.from("memories").update({ vector_id: row.data.id }).eq("id", row.data.id);
      }
    } catch {
      vectorStore = "postgres";
    }
  }
  return { id: row.data.id, vectorStore };
}

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function recallFacts(params: {
  query: string;
  limit?: number;
  sessionId?: string;
}): Promise<{ store: string; results: MemoryRecord[] }> {
  const limit = params.limit ?? 5;
  const pineconeKey = optionalEnv("PINECONE_API_KEY");
  if (pineconeKey) {
    try {
      const vector = await embed(params.query);
      const host = await pineconeHost(pineconeKey);
      const res = await fetch(`https://${host}/query`, {
        method: "POST",
        headers: { "Api-Key": pineconeKey, "Content-Type": "application/json" },
        body: JSON.stringify({ vector, topK: limit, includeMetadata: true }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          matches?: Array<{ id: string; score: number; metadata?: { content?: string; tags?: string[] } }>;
        };
        return {
          store: "pinecone",
          results: (data.matches ?? []).map((m) => ({
            id: m.id,
            content: m.metadata?.content ?? "",
            tags: m.metadata?.tags ?? [],
            score: m.score,
          })),
        };
      }
    } catch {
      /* repli base de données */
    }
  }

  const rows = await supabaseAdmin
    .from("memories")
    .select("id, content, tags")
    .order("created_at", { ascending: false })
    .limit(300);
  if (rows.error) throw new Error(`Lecture de la mémoire échouée : ${rows.error.message}`);
  const q = params.query.toLowerCase();
  const scored = (rows.data ?? []).map((r) => ({
    id: r.id,
    content: r.content,
    tags: r.tags ?? [],
    score: r.content.toLowerCase().includes(q) ? 1 : 0,
  }));
  scored.sort((a, b) => b.score - a.score);
  return { store: "postgres", results: scored.slice(0, limit) };
}

export { cosine };
