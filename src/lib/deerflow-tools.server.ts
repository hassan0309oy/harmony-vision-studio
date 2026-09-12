import { tool } from "ai";
import { z } from "zod";

/** Web search — uses Tavily when a key is configured. */
export const webSearch = tool({
  description:
    "Recherche sur le web en temps réel. Retourne des résultats avec titre, URL et extrait, à citer dans la réponse.",
  inputSchema: z.object({
    query: z.string().describe("La requête de recherche"),
    maxResults: z.number().optional().describe("Nombre de résultats souhaités"),
  }),
  execute: async ({ query, maxResults }) => {
    const key = process.env["TAVILY_API_KEY"];
    if (!key) {
      return {
        error:
          "Recherche web non configurée : la clé TAVILY_API_KEY est manquante. Réponds sans recherche et signale-le à l'utilisateur.",
      };
    }
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query,
        max_results: Math.min(maxResults ?? 5, 10),
        search_depth: "advanced",
        include_answer: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { error: `Recherche échouée [${res.status}]: ${body.slice(0, 500)}` };
    }
    const data = (await res.json()) as {
      answer?: string;
      results?: Array<{ title: string; url: string; content: string }>;
    };
    return {
      answer: data.answer ?? null,
      results: (data.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content?.slice(0, 1200) ?? "",
      })),
    };
  },
});

/** Read a public URL and return its readable text. */
export const fetchUrl = tool({
  description:
    "Extrait le contenu texte d'une page web publique à partir de son URL, pour l'analyser ou la citer.",
  inputSchema: z.object({ url: z.string().describe("URL http(s) publique") }),
  execute: async ({ url }) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { error: "URL invalide" };
    }
    if (!/^https?:$/.test(parsed.protocol)) return { error: "Seules les URL http(s) sont acceptées" };

    const res = await fetch(parsed.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DeerFlowBot/1.0)" },
    });
    if (!res.ok) return { error: `Lecture échouée [${res.status}]` };
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { url: parsed.toString(), text: text.slice(0, 12000) };
  },
});

/** Produce a file artifact rendered in the right-hand panel. */
export const writeArtifact = tool({
  description:
    "Crée un fichier (rapport markdown, code, page HTML, CSV…) affiché dans le panneau Artifacts. Utilise-le dès qu'un livrable est demandé.",
  inputSchema: z.object({
    path: z.string().describe("Nom du fichier, ex: rapport.md ou index.html"),
    language: z.string().describe("markdown, html, typescript, python, csv, json…"),
    content: z.string().describe("Contenu complet du fichier"),
  }),
  execute: async ({ path, language, content }) => ({
    path,
    language,
    content,
    bytes: content.length,
    status: "created",
  }),
});

/** Explicit multi-step plan, shown as a todo list. */
export const makePlan = tool({
  description:
    "Établit ou met à jour le plan d'exécution en étapes pour une mission complexe (Deep Research, missions multi-étapes).",
  inputSchema: z.object({
    title: z.string(),
    steps: z.array(z.object({ step: z.string(), done: z.boolean() })),
  }),
  execute: async ({ title, steps }) => ({ title, steps }),
});

export const deerflowTools = {
  web_search: webSearch,
  fetch_url: fetchUrl,
  write_artifact: writeArtifact,
  make_plan: makePlan,
};
