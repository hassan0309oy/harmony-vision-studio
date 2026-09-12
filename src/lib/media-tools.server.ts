import { tool } from "ai";
import { z } from "zod";

import { generateImage } from "./providers/image.server";
import { generateVideo } from "./providers/video.server";
import { generateMusic, synthesizePodcast, synthesizeSpeech } from "./providers/audio.server";
import { buildPresentation } from "./providers/pptx.server";
import { recallFacts, rememberFact } from "./providers/memory.server";
import { livePreview, runInSandbox } from "./providers/sandbox.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { optionalEnv } from "./providers/errors.server";
import { preferredProvider } from "./providers/settings.server";
import { editAttachedVideo } from "./providers/video-edit.server";


/** Toute erreur devient un message exploitable par l'agent — jamais un faux succès. */
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

/** Applique le fournisseur choisi dans les réglages quand l'agent n'en impose pas. */
async function withPreferred<T extends { provider?: string | undefined }>(
  kind: "image" | "video" | "audio" | "memory",
  input: T,
): Promise<T> {

  if (input.provider && input.provider !== "auto") return input;
  const preferred = await preferredProvider(kind);
  return preferred ? { ...input, provider: preferred } : input;
}

export const generateImageTool = tool({
  description:
    "Génère une VRAIE image à partir d'une description. Fournisseurs interchangeables (openai, gemini, huggingface, lovable) avec repli automatique. Retourne une URL téléchargeable affichée dans le chat.",
  inputSchema: z.object({
    prompt: z.string(),
    size: z.string().optional().describe("ex: 1024x1024"),
    provider: z.string().optional().describe("auto, openai, gemini, huggingface, lovable"),
  }),
  execute: async (input) =>
    attempt("la génération d'image", async () =>
      generateImage((await withPreferred("image", input)) as Parameters<typeof generateImage>[0]),
    ),
});

export const generateVideoTool = tool({
  description:
    "Génère une VRAIE vidéo à partir d'une description (Runway, puis Replicate en repli). Peut prendre plusieurs minutes.",
  inputSchema: z.object({
    prompt: z.string(),
    durationSeconds: z.number().optional(),
    provider: z.string().optional().describe("auto, runway, replicate"),
  }),
  execute: async (input) =>
    attempt("la génération de vidéo", async () =>
      generateVideo((await withPreferred("video", input)) as Parameters<typeof generateVideo>[0]),
    ),
});

export const generateMusicTool = tool({
  description: "Génère un morceau de musique ou une ambiance sonore réelle (Hugging Face, Replicate).",
  inputSchema: z.object({
    prompt: z.string(),
    durationSeconds: z.number().optional(),
    provider: z.string().optional(),
  }),
  execute: async (input) =>
    attempt("la génération de musique", async () =>
      generateMusic((await withPreferred("audio", input)) as Parameters<typeof generateMusic>[0]),
    ),
});

export const textToSpeechTool = tool({
  description: "Synthétise un texte en voix réelle (ElevenLabs, Kokoro, Piper) et renvoie un fichier audio.",
  inputSchema: z.object({
    text: z.string(),
    voiceId: z.string().optional(),
    provider: z.string().optional(),
  }),
  execute: async (input) =>
    attempt("la synthèse vocale", async () =>
      synthesizeSpeech(
        (await withPreferred("audio", input)) as Parameters<typeof synthesizeSpeech>[0],
      ),
    ),
});


export const createPodcastTool = tool({
  description:
    "Produit un podcast multi-voix : chaque réplique est réellement synthétisée puis assemblée en un seul fichier audio.",
  inputSchema: z.object({
    title: z.string(),
    segments: z.array(
      z.object({ speaker: z.string(), text: z.string(), voiceId: z.string().optional() }),
    ),
    provider: z.string().optional(),
  }),
  execute: async (input) => attempt("le podcast", () => synthesizePodcast(input as Parameters<typeof synthesizePodcast>[0])),
});

export const createPresentationTool = tool({
  description: "Crée un vrai fichier PowerPoint .pptx téléchargeable.",
  inputSchema: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    slides: z.array(
      z.object({
        title: z.string(),
        bullets: z.array(z.string()).optional(),
        notes: z.string().optional(),
      }),
    ),
  }),
  execute: async (input) => attempt("la présentation PowerPoint", () => buildPresentation(input as Parameters<typeof buildPresentation>[0])),
});

export const rememberTool = tool({
  description:
    "Mémorise durablement une information importante sur l'utilisateur ou le projet (mémoire longue durée).",
  inputSchema: z.object({
    content: z.string(),
    tags: z.array(z.string()).optional(),
    importance: z.number().optional(),
  }),
  execute: async (input) => attempt("la mémoire persistante", () => rememberFact(input as Parameters<typeof rememberFact>[0])),
});

export const recallTool = tool({
  description: "Retrouve dans la mémoire longue durée les informations liées à une question.",
  inputSchema: z.object({ query: z.string(), limit: z.number().optional() }),
  execute: async (input) => attempt("la lecture de la mémoire", () => recallFacts(input as Parameters<typeof recallFacts>[0])),
});

export const runCodeTool = tool({
  description:
    "Exécute réellement du code Python ou JavaScript dans un sandbox isolé et renvoie la sortie réelle. Utilise-le pour l'analyse de données et les calculs vérifiables.",
  inputSchema: z.object({
    language: z.enum(["python", "javascript"]),
    code: z.string(),
  }),
  execute: async (input) => attempt("l'exécution en sandbox", () => runInSandbox(input)),
});

export const livePreviewTool = tool({
  description:
    "Déploie des fichiers d'application dans le sandbox, lance la commande de démarrage et renvoie une URL d'aperçu en direct affichée à côté du chat.",
  inputSchema: z.object({
    files: z.array(z.object({ path: z.string(), content: z.string() })),
    startCommand: z.string(),
    port: z.number(),
  }),
  execute: async (input) => attempt("l'aperçu en direct", () => livePreview(input)),
});

/** Outil de montage lié à l'utilisateur : la source doit lui appartenir. */
export function createVideoEditingTools(userId: string) {
  return {
    edit_video: tool({
      description:
        "Monte réellement une vidéo jointe avec FFmpeg et renvoie le MP4 final avec aperçu et téléchargement. Utilise-le pour recadrer, couper, masquer des logos, ajouter des sous-titres ASS/SRT animés, étalonner les couleurs, mixer la voix, la musique et les effets sonores. Les chemins disponibles sont /tmp/input.mp4 (ou extension source), /tmp/subtitles.ass ou /tmp/subtitles.srt, et la sortie est ajoutée automatiquement : ne mets ni `ffmpeg`, ni entrée, ni chemin de sortie dans ffmpegArgs.",
      inputSchema: z.object({
        attachmentId: z.string().uuid().describe("Identifiant de la vidéo jointe à monter."),
        ffmpegArgs: z
          .array(z.string())
          .describe("Arguments FFmpeg séparés, par exemple ['-vf', 'crop=...', '-c:v', 'libx264', '-c:a', 'aac']."),
        subtitleFile: z
          .object({
            format: z.enum(["ass", "srt"]),
            content: z.string(),
          })
          .optional()
          .describe("Sous-titres complets. Dans les filtres, référence /tmp/subtitles.ass ou /tmp/subtitles.srt."),
        fileName: z.string().optional().describe("Nom du MP4 final."),
        description: z.string().optional().describe("Résumé du montage appliqué."),
      }),
      execute: async (input) =>
        attempt("le montage vidéo", () => editAttachedVideo({ ...input, userId })),
    }),
  };
}

export const browseWebTool = tool({
  description:
    "Navigateur agentique : ouvre une page (même dynamique) via Firecrawl et renvoie son contenu lisible, ses liens et ses métadonnées. Plus fiable que fetch_url pour les sites protégés.",
  inputSchema: z.object({
    url: z.string(),
    formats: z.array(z.string()).optional(),
  }),
  execute: async ({ url, formats }) =>
    attempt("le navigateur agentique", async () => {
      const key = optionalEnv("FIRECRAWL_API_KEY");
      if (!key) throw new Error("FIRECRAWL_API_KEY absente : le navigateur agentique est indisponible.");
      const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ url, formats: formats ?? ["markdown", "links"], onlyMainContent: true }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Firecrawl [${res.status}] ${text.slice(0, 400)}`);
      const data = JSON.parse(text) as {
        markdown?: string;
        links?: string[];
        metadata?: unknown;
        data?: { markdown?: string; links?: string[]; metadata?: unknown };
      };
      const doc = data.data ?? data;
      return {
        url,
        markdown: (doc.markdown ?? "").slice(0, 15000),
        links: (doc.links ?? []).slice(0, 40),
        metadata: doc.metadata ?? null,
      };
    }),
});

export const scheduleTaskTool = tool({
  description:
    "Programme une mission récurrente (expression cron) qui sera relancée automatiquement par le planificateur.",
  inputSchema: z.object({
    title: z.string(),
    instruction: z.string(),
    cron: z.string().describe("Expression cron, ex: 0 8 * * 1"),
  }),
  execute: async (input) =>
    attempt("la planification de tâche", async () => {
      const row = await supabaseAdmin
        .from("scheduled_tasks")
        .insert({ title: input.title, instruction: input.instruction, cron: input.cron })
        .select("id, title, cron, active")
        .single();
      if (row.error || !row.data) throw new Error(row.error?.message ?? "Insertion impossible");
      return row.data;
    }),
});

export const listTasksTool = tool({
  description: "Liste les tâches programmées existantes avec leur dernier résultat.",
  inputSchema: z.object({}),
  execute: async () =>
    attempt("la lecture des tâches programmées", async () => {
      const rows = await supabaseAdmin
        .from("scheduled_tasks")
        .select("id, title, cron, active, last_run_at, last_result")
        .order("created_at", { ascending: false })
        .limit(50);
      if (rows.error) throw new Error(rows.error.message);
      return { tasks: rows.data ?? [] };
    }),
});

export const mediaTools = {
  generate_image: generateImageTool,
  generate_video: generateVideoTool,
  generate_music: generateMusicTool,
  text_to_speech: textToSpeechTool,
  create_podcast: createPodcastTool,
  create_presentation: createPresentationTool,
  remember: rememberTool,
  recall: recallTool,
  run_code: runCodeTool,
  live_preview: livePreviewTool,
  browse_web: browseWebTool,
  schedule_task: scheduleTaskTool,
  list_tasks: listTasksTool,
};
