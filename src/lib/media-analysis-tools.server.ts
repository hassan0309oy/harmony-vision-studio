import { tool } from "ai";
import { z } from "zod";

import { analyzeAttachmentById, analyzeMediaSource } from "./providers/media-analysis.server";

function render(result: Awaited<ReturnType<typeof analyzeMediaSource>>) {
  const t = result.technical;
  const techLines = [
    t.durationLabel ? `- Durée : ${t.durationLabel} (${t.durationSeconds?.toFixed(2)} s)` : null,
    t.width && t.height ? `- Résolution : ${t.width}×${t.height}` : null,
    t.fps ? `- Images par seconde : ${t.fps}` : null,
    t.frameCount ? `- Nombre d'images : ${t.frameCount}` : null,
    `- Taille : ${(result.sizeBytes / 1048576).toFixed(2)} Mo`,
    `- Type : ${result.mimeType}`,
  ].filter(Boolean);

  return [
    `# Analyse de ${result.source}`,
    `## Données techniques mesurées`,
    techLines.join("\n"),
    result.notes.length ? `\n> ${result.notes.join("\n> ")}` : "",
    `\n${result.analysis}`,
    `\n_Analyse réalisée par ${result.model}._`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Outils d'analyse média liés à un utilisateur authentifié (aucun accès croisé possible). */
export function createMediaAnalysisTools(userId: string) {
  return {
    analyze_attached_media: tool({
      description:
        "Analyse une vidéo ou un fichier audio joint par l'utilisateur : chronologie, plans, transitions, audio, rythme, moments clés, avec timecodes réels. À utiliser dès qu'une vidéo ou un audio est joint.",
      inputSchema: z.object({
        attachmentId: z.string().uuid().describe("Identifiant de la pièce jointe fournie dans le contexte."),
        question: z.string().optional().describe("Question précise de l'utilisateur."),
      }),
      execute: async ({ attachmentId, question }) => {
        try {
          const result = await analyzeAttachmentById({ attachmentId, userId, question: question ?? undefined });
          return render(result);
        } catch (error) {
          return `❌ Analyse impossible : ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    }),
    analyze_media_url: tool({
      description:
        "Analyse une vidéo ou un audio accessible par URL, y compris un lien Google Drive partagé publiquement. Télécharge réellement le fichier avant analyse.",
      inputSchema: z.object({
        url: z.string().url(),
        question: z.string().optional(),
      }),
      execute: async ({ url, question }) => {
        try {
          const result = await analyzeMediaSource({ url, question: question ?? undefined });
          return render(result);
        } catch (error) {
          return `❌ Analyse impossible : ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    }),
  };
}
