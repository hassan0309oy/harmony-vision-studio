import { tool, generateText, stepCountIs, type ToolSet } from "ai";
import { z } from "zod";

import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { deerflowTools } from "./deerflow-tools.server";
import { mediaTools } from "./media-tools.server";
import { livePreview } from "./providers/sandbox.server";
import { storeAsset } from "./providers/storage.server";
import { readPreferences } from "./providers/settings.server";

async function attempt<T>(label: string, run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    return {
      ok: false as const,
      capability: label,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const CHART_TYPES = ["line", "bar", "area", "pie"] as const;

type ChartPoint = { label: string; [k: string]: string | number };

function chartPage(title: string, type: string, points: ChartPoint[], series: string[]) {
  const labels = points.map((p) => String(p.label));
  const datasets = series.map((s, i) => ({
    label: s,
    data: points.map((p) => Number(p[s] ?? 0)),
    borderColor: `hsl(${(i * 67) % 360} 80% 55%)`,
    backgroundColor: `hsl(${(i * 67) % 360} 80% 55% / 0.45)`,
    fill: type === "area",
    tension: 0.3,
  }));
  const cjsType = type === "area" ? "line" : type;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>body{margin:0;background:#0b0f14;color:#e6edf3;font-family:system-ui,sans-serif;padding:24px}
h1{font-size:18px;margin:0 0 16px}.wrap{max-width:960px;margin:0 auto}canvas{background:#111820;border-radius:12px;padding:12px}</style>
</head><body><div class="wrap"><h1>${title}</h1><canvas id="c"></canvas></div>
<script>new Chart(document.getElementById('c'),{type:${JSON.stringify(cjsType)},data:{labels:${JSON.stringify(labels)},datasets:${JSON.stringify(datasets)}},options:{responsive:true,plugins:{legend:{labels:{color:'#e6edf3'}}},scales:${
    cjsType === "pie"
      ? "{}"
      : "{x:{ticks:{color:'#9fb0c0'},grid:{color:'#1d2733'}},y:{ticks:{color:'#9fb0c0'},grid:{color:'#1d2733'}}}"
  }}});</script></body></html>`;
}

/** Real chart rendered in the chat + a standalone shareable web page. */
export const renderChartTool = tool({
  description:
    "Affiche un VRAI graphique interactif dans le chat (courbe, barres, aires, camembert) et génère en plus une page web autonome partageable. Utilise-le dès qu'une donnée chiffrée doit être visualisée.",
  inputSchema: z.object({
    title: z.string(),
    type: z.enum(CHART_TYPES),
    series: z.array(z.string()).describe("Noms des séries de valeurs, ex: ['ventes']"),
    points: z
      .array(z.object({ label: z.string() }).catchall(z.union([z.string(), z.number()])))
      .describe("Points de données : { label, <série>: nombre }"),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
  }),
  execute: async ({ title, type, series, points, xLabel, yLabel }) =>
    attempt("le graphique", async () => {
      const html = chartPage(title, type, points as ChartPoint[], series);
      const stored = await storeAsset({
        kind: "chart",
        data: new TextEncoder().encode(html),
        mimeType: "text/html",
        provider: "chartjs",
        prompt: title,
      });
      return {
        title,
        type,
        series,
        points,
        xLabel: xLabel ?? null,
        yLabel: yLabel ?? null,
        pageUrl: stored.url,
      };
    }),
});

async function runSubAgent(params: {
  role: string;
  instruction: string;
  tools: ToolSet;
  model?: string | undefined;
  steps?: number;
}) {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY absente : les sous-agents sont indisponibles.");
  const prefs = await readPreferences();
  const modelId = params.model ?? prefs["chat_model"] ?? "google/gemini-3.7-flash";
  const gateway = createLovableAiGatewayProvider(key);
  const result = await generateText({
    model: gateway(modelId),
    system: `Tu es un sous-agent spécialisé « ${params.role} » travaillant pour l'agent principal DeerFlow.
Exécute la mission avec les outils réels dont tu disposes, sans jamais simuler un résultat.
Rends un compte rendu final en français, structuré en markdown, avec les liens/sources et les URL des fichiers produits.`,
    prompt: params.instruction,
    tools: params.tools,
    stopWhen: stepCountIs(params.steps ?? 25),
  });
  return { role: params.role, model: modelId, report: result.text, steps: result.steps.length };
}

const RESEARCH_TOOLS = {
  web_search: deerflowTools.web_search,
  fetch_url: deerflowTools.fetch_url,
  browse_web: mediaTools.browse_web,
};

const SUBAGENT_TOOLSETS: Record<string, ToolSet> = {
  recherche: RESEARCH_TOOLS,
  media: {
    generate_image: mediaTools.generate_image,
    generate_video: mediaTools.generate_video,
    generate_music: mediaTools.generate_music,
    text_to_speech: mediaTools.text_to_speech,
    create_podcast: mediaTools.create_podcast,
    create_presentation: mediaTools.create_presentation,
  },
  code: {
    run_code: mediaTools.run_code,
    write_artifact: deerflowTools.write_artifact,
  },
  analyse: {
    run_code: mediaTools.run_code,
    render_chart: renderChartTool,
    web_search: deerflowTools.web_search,
  },
};

/** Delegate a sub-mission to a specialised agent with its own tool subset. */
export const delegateTool = tool({
  description:
    "Délègue une sous-mission à un sous-agent spécialisé (recherche, media, code, analyse) qui travaille en autonomie avec ses propres outils et renvoie un compte rendu. Utilise-le pour paralléliser ou isoler une partie complexe d'une mission.",
  inputSchema: z.object({
    role: z.enum(["recherche", "media", "code", "analyse"]),
    instruction: z.string().describe("Mission complète et autonome confiée au sous-agent"),
    model: z.string().optional(),
  }),
  execute: async ({ role, instruction, model }) =>
    attempt("le sous-agent", () =>
      runSubAgent({
        role,
        instruction,
        tools: SUBAGENT_TOOLSETS[role] ?? RESEARCH_TOOLS,
        model,
      }),
    ),
});

/** Multi-step sourced research pipeline. */
export const deepResearchTool = tool({
  description:
    "Deep Research : enchaîne recherches web multiples, lecture des sources et rédaction d'un rapport long, structuré et sourcé. À utiliser pour toute demande de veille, d'étude ou de rapport documenté.",
  inputSchema: z.object({
    question: z.string(),
    depth: z.number().optional().describe("Nombre d'angles de recherche, 3 par défaut"),
  }),
  execute: async ({ question, depth }) =>
    attempt("le deep research", async () => {
      const angles = Math.min(Math.max(depth ?? 3, 2), 6);
      const run = await runSubAgent({
        role: "deep research",
        instruction: `Question de recherche : ${question}

Procédure obligatoire :
1. Lance au moins ${angles} recherches web sur des angles différents (web_search).
2. Ouvre et lis au minimum ${angles + 2} sources pertinentes (fetch_url ou browse_web).
3. Croise les informations, signale les contradictions et l'incertitude.
4. Rends un rapport markdown structuré : Synthèse, Contexte, Constats détaillés, Chiffres clés, Limites, Sources (liste de liens markdown cliquables).
N'invente aucune source ni aucun chiffre.`,
        tools: RESEARCH_TOOLS,
        steps: 40,
      });
      return { question, report: run.report, model: run.model, steps: run.steps };
    }),
});

/** No-code build: real files deployed in the sandbox with a live preview + code view. */
export const buildAppTool = tool({
  description:
    "Mode no-code : construit une application ou un site web réel. Écrit tous les fichiers, les déploie dans le sandbox et renvoie une URL d'aperçu en direct plus le code, affichés dans le panneau Aperçu/Code à côté du chat. Utilise-le dès qu'on demande de créer un site, une page ou une application.",
  inputSchema: z.object({
    name: z.string().describe("Nom du projet"),
    files: z
      .array(z.object({ path: z.string(), content: z.string() }))
      .describe("Tous les fichiers du projet, contenu complet"),
    startCommand: z
      .string()
      .describe("Commande de démarrage, ex: python3 -m http.server 3000 pour un site statique"),
    port: z.number().describe("Port exposé par la commande de démarrage"),
  }),
  execute: async ({ name, files, startCommand, port }) =>
    attempt("la construction d'application", async () => {
      const preview = await livePreview({ files, startCommand, port });
      return { name, files, previewUrl: preview.previewUrl, sandboxId: preview.sandboxId };
    }),
});

export const agentTools = {
  render_chart: renderChartTool,
  delegate: delegateTool,
  deep_research: deepResearchTool,
  build_app: buildAppTool,
};
