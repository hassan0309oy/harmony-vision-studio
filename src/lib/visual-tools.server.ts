import { tool } from "ai";
import { z } from "zod";

import {
  analyzeVisualReference,
  analyzeVisualReferenceById,
  generateImageFromReferences,
  resolveReferenceUrls,
} from "./providers/visual-reference.server";

function fail(label: string, error: unknown) {
  return {
    ok: false as const,
    capability: label,
    error: error instanceof Error ? error.message : String(error),
  };
}

/** Outils d'analyse visuelle liés à un utilisateur authentifié (aucun accès croisé). */
export function createVisualReferenceTools(userId: string) {
  return {
    analyze_visual_reference: tool({
      description:
        "Analyse visuellement une image ou une vidéo jointe (ou une URL) et renvoie une fiche de style réutilisable : palette hexadécimale, cadrage, lumière, typographie des textes à l'écran, mouvement, plus un prompt de reproduction. À appeler AVANT toute génération devant reprendre le style d'un média envoyé par l'utilisateur.",
      inputSchema: z.object({
        attachmentId: z.string().uuid().optional().describe("Identifiant de la pièce jointe."),
        url: z.string().url().optional().describe("URL publique d'une image ou d'une vidéo."),
        question: z.string().optional().describe("Ce que l'utilisateur veut reproduire."),
      }),
      execute: async ({ attachmentId, url, question }) => {
        try {
          if (attachmentId) {
            return await analyzeVisualReferenceById({ attachmentId, userId, question: question ?? undefined });
          }
          if (url) return await analyzeVisualReference({ url, question: question ?? undefined });
          return fail("l'analyse visuelle", new Error("Fournis attachmentId ou url."));
        } catch (error) {
          return fail("l'analyse visuelle", error);
        }
      },
    }),
    generate_image_from_reference: tool({
      description:
        "Génère une VRAIE image en reprenant fidèlement le style d'images de référence jointes par l'utilisateur (palette, cadrage, lumière, typographie). Utilise-le dès qu'une génération doit ressembler à une photo envoyée. Combine-le avec la fiche de style d'analyze_visual_reference.",
      inputSchema: z.object({
        prompt: z.string().describe("Ce qui doit être représenté."),
        referenceAttachmentIds: z
          .array(z.string().uuid())
          .describe("Pièces jointes image servant de référence (1 à 4)."),
        styleSpec: z.string().optional().describe("Fiche de style issue de analyze_visual_reference."),
      }),
      execute: async ({ prompt, referenceAttachmentIds, styleSpec }) => {
        try {
          const { urls, skipped } = await resolveReferenceUrls(referenceAttachmentIds, userId);
          if (urls.length === 0) {
            throw new Error(
              `Aucune image de référence exploitable${skipped.length ? ` (ignoré : ${skipped.join(", ")})` : ""}. Pour une vidéo, utilise analyze_visual_reference puis generate_image avec la fiche de style.`,
            );
          }
          const asset = await generateImageFromReferences({ prompt, referenceUrls: urls, styleSpec });
          return { ...asset, ...(skipped.length ? { ignored: skipped } : {}) };
        } catch (error) {
          return fail("la génération guidée par référence", error);
        }
      },
    }),
  };
}
