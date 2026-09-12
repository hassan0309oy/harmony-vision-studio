/**
 * Outils DeAPI liés à l'utilisateur : retouche, agrandissement, détourage,
 * image → vidéo, transcription audio/vidéo et embeddings.
 * La source doit toujours appartenir à l'utilisateur connecté.
 */
import { tool } from "ai";
import { z } from "zod";

import {
  downloadAttachment,
  loadOwnedAttachments,
  signedAttachmentUrl,
  type AttachmentRow,
} from "./providers/attachments.server";
import {
  deapiEditImage,
  deapiEmbeddings,
  deapiRemoveBackground,
  deapiTranscribe,
  deapiUpscaleImage,
} from "./providers/deapi.server";
import { animateImageToVideo } from "./providers/video.server";
import { storeAsset } from "./providers/storage.server";

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

async function ownedAttachment(attachmentId: string, userId: string): Promise<AttachmentRow> {
  const rows = await loadOwnedAttachments([attachmentId], userId);
  const row = rows[0];
  if (!row) throw new Error("Fichier introuvable ou inaccessible.");
  return row;
}

async function loadImage(attachmentId: string, userId: string) {
  const row = await ownedAttachment(attachmentId, userId);
  if (!row.mime_type.startsWith("image/")) {
    throw new Error(`Le fichier « ${row.name} » n'est pas une image.`);
  }
  return { row, bytes: await downloadAttachment(row.storage_path) };
}

/** Outils nécessitant l'identité de l'utilisateur (fichiers joints). */
export function createDeapiTools(userId: string) {
  return {
    edit_image: tool({
      description:
        "Modifie ou améliore une IMAGE JOINTE selon une consigne (changer un élément, corriger, restyler) avec DeAPI. Renvoie la nouvelle image téléchargeable.",
      inputSchema: z.object({
        attachmentId: z.string().uuid().describe("Identifiant de l'image jointe."),
        prompt: z.string().describe("Modification souhaitée, en une phrase claire."),
      }),
      execute: async ({ attachmentId, prompt }) =>
        attempt("la retouche d'image", async () => {
          const { row, bytes } = await loadImage(attachmentId, userId);
          const result = await deapiEditImage({
            imageBytes: bytes,
            mimeType: row.mime_type,
            prompt,
            fileName: row.name,
          });
          return storeAsset({
            kind: "image",
            data: result.bytes,
            mimeType: result.mimeType,
            provider: "deapi",
            prompt,
            metadata: { source: "image-edit", from: row.name },
          });
        }),
    }),

    upscale_image: tool({
      description:
        "Agrandit une IMAGE JOINTE (x4) en améliorant la netteté avec DeAPI. Renvoie l'image haute résolution.",
      inputSchema: z.object({ attachmentId: z.string().uuid() }),
      execute: async ({ attachmentId }) =>
        attempt("l'agrandissement d'image", async () => {
          const { row, bytes } = await loadImage(attachmentId, userId);
          const result = await deapiUpscaleImage({
            imageBytes: bytes,
            mimeType: row.mime_type,
            fileName: row.name,
          });
          return storeAsset({
            kind: "image",
            data: result.bytes,
            mimeType: result.mimeType,
            provider: "deapi",
            prompt: `Agrandissement de ${row.name}`,
            metadata: { source: "image-upscale", from: row.name },
          });
        }),
    }),

    remove_image_background: tool({
      description: "Détoure une IMAGE JOINTE : supprime l'arrière-plan et renvoie un PNG transparent.",
      inputSchema: z.object({ attachmentId: z.string().uuid() }),
      execute: async ({ attachmentId }) =>
        attempt("le détourage d'image", async () => {
          const { row, bytes } = await loadImage(attachmentId, userId);
          const result = await deapiRemoveBackground({
            imageBytes: bytes,
            mimeType: row.mime_type,
            fileName: row.name,
          });
          return storeAsset({
            kind: "image",
            data: result.bytes,
            mimeType: result.mimeType,
            provider: "deapi",
            prompt: `Détourage de ${row.name}`,
            metadata: { source: "image-rmbg", from: row.name },
          });
        }),
    }),

    image_to_video: tool({
      description:
        "Transforme une IMAGE JOINTE en VRAIE vidéo animée (l'image sert de première image). Décris le mouvement souhaité. Peut prendre plusieurs minutes.",
      inputSchema: z.object({
        attachmentId: z.string().uuid(),
        prompt: z.string().describe("Mouvement / animation souhaité."),
        durationSeconds: z.number().nullable().optional(),
      }),
      execute: async ({ attachmentId, prompt, durationSeconds }) =>
        attempt("l'animation image vers vidéo", async () => {
          const { row, bytes } = await loadImage(attachmentId, userId);
          return animateImageToVideo({
            imageBytes: bytes,
            mimeType: row.mime_type,
            prompt,
            fileName: row.name,
            ...(durationSeconds ? { durationSeconds } : {}),
          });
        }),
    }),

    transcribe_media: tool({
      description:
        "Transcrit réellement un fichier audio ou vidéo JOINT, ou une URL publique (YouTube incluse), avec horodatages. Fournis attachmentId OU sourceUrl.",
      inputSchema: z.object({
        attachmentId: z.string().uuid().nullable().optional(),
        sourceUrl: z.string().nullable().optional(),
        includeTimestamps: z.boolean().nullable().optional(),
      }),
      execute: async ({ attachmentId, sourceUrl, includeTimestamps }) =>
        attempt("la transcription", async () => {
          let url = sourceUrl ?? undefined;
          let name: string | undefined;
          if (attachmentId) {
            const row = await ownedAttachment(attachmentId, userId);
            url = await signedAttachmentUrl(row.storage_path);
            name = row.name;
          }
          if (!url) throw new Error("Fournis un fichier joint ou une URL à transcrire.");
          const transcript = await deapiTranscribe({
            sourceUrl: url,
            includeTimestamps: includeTimestamps ?? true,
          });
          return {
            ...(name ? { fileName: name } : { sourceUrl: url }),
            language: transcript.language ?? null,
            text: transcript.text.slice(0, 40000),
            segments: (transcript.segments ?? []).slice(0, 400),
          };
        }),
    }),
  };
}

/** Embeddings : vectorisation de textes pour recherche sémantique. */
export const embedTextsTool = tool({
  description:
    "Calcule les embeddings (vecteurs) réels d'une liste de textes avec DeAPI, pour la recherche sémantique ou la comparaison de similarité.",
  inputSchema: z.object({
    texts: z.array(z.string()).describe("Textes à vectoriser."),
    compare: z
      .boolean()
      .nullable()
      .optional()
      .describe("Si vrai, renvoie aussi la similarité cosinus entre le premier texte et les suivants."),
  }),
  execute: async ({ texts, compare }) =>
    attempt("les embeddings", async () => {
      const vectors = await deapiEmbeddings(texts);
      const cosine = (a: number[], b: number[]) => {
        let dot = 0;
        let na = 0;
        let nb = 0;
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
          dot += a[i]! * b[i]!;
          na += a[i]! * a[i]!;
          nb += b[i]! * b[i]!;
        }
        return na && nb ? dot / Math.sqrt(na * nb) : 0;
      };
      const first = vectors[0] ?? [];
      return {
        count: vectors.length,
        dimensions: first.length,
        preview: vectors.map((v) => v.slice(0, 8)),
        ...(compare && vectors.length > 1
          ? {
              similarities: vectors.slice(1).map((v, i) => ({
                text: texts[i + 1] ?? "",
                similarity: Number(cosine(first, v).toFixed(4)),
              })),
            }
          : {}),
      };
    }),
});
