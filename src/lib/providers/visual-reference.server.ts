import { loadOwnedAttachments, signedAttachmentUrl, type AttachmentRow } from "./attachments.server";
import { b64ToBytes, storeAsset, type StoredAsset } from "./storage.server";
import { optionalEnv } from "./errors.server";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const VISION_MODELS = ["google/gemini-3.8-flash", "google/gemini-3.7-flash"];

function requireGatewayKey() {
  const key = optionalEnv("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY absente : l'analyse visuelle est indisponible.");
  return key;
}

const STYLE_PROMPT = `Tu es directeur artistique. Observe RÉELLEMENT le média fourni et produis une fiche de style réutilisable telle quelle comme prompt de génération.

Rends un markdown avec exactement ces sections :
1. **Sujet & composition** : cadrage, ratio, placement des sujets, profondeur, angle d'objectif.
2. **Palette** : 4 à 6 couleurs dominantes en hexadécimal avec leur rôle (fond, accent, texte).
3. **Lumière & rendu** : source, contraste, grain, netteté, style (photo, 3D, illustration…).
4. **Typographie & textes à l'écran** : police (famille approchante), graisse, casse, taille relative, contour/ombre, position, couleur des mots mis en avant.
5. **Mouvement & rythme** (vidéo uniquement) : durée des plans, transitions, vitesse, effets.
6. **Prompt de reproduction** : un unique paragraphe prêt à copier pour régénérer une image ou une vidéo dans EXACTEMENT ce style.
7. **À éviter** : éléments présents à ne pas reproduire (logos, filigranes, incrustations).

N'invente rien : écris « non perceptible » si un élément n'est pas observable.`;

async function callVision(content: Array<Record<string, unknown>>) {
  const key = requireGatewayKey();
  let lastError = "";
  for (const model of VISION_MODELS) {
    const res = await fetch(`${GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({ model, messages: [{ role: "user", content }] }),
    });
    const text = await res.text();
    if (res.ok) {
      const payload = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
      const out = payload.choices?.[0]?.message?.content?.trim();
      if (out) return { model, styleSpec: out };
      lastError = "Réponse vide du modèle.";
      continue;
    }
    lastError = `[${res.status}] ${text.slice(0, 300)}`;
    if ([401, 402, 403].includes(res.status)) break;
  }
  throw new Error(`Analyse visuelle échouée : ${lastError}`);
}

export type VisualReference = {
  ok: true;
  source: string;
  mediaType: string;
  url: string;
  model: string;
  styleSpec: string;
};

/** Fiche de style réelle extraite d'une image ou d'une vidéo (jointe ou par URL). */
export async function analyzeVisualReference(params: {
  attachment?: AttachmentRow | undefined;
  url?: string | undefined;
  mediaType?: string | undefined;
  question?: string | undefined;
}): Promise<VisualReference> {
  const url = params.attachment
    ? await signedAttachmentUrl(params.attachment.storage_path)
    : params.url;
  if (!url) throw new Error("Aucune image ni vidéo de référence fournie.");
  const mediaType = params.attachment?.mime_type ?? params.mediaType ?? "image/jpeg";
  const isVideo = mediaType.startsWith("video/");

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `${STYLE_PROMPT}\n\nDemande de l'utilisateur : ${params.question ?? "Fiche de style complète."}`,
    },
    isVideo ? { type: "video_url", video_url: { url } } : { type: "image_url", image_url: { url } },
  ];

  const { model, styleSpec } = await callVision(content);
  return {
    ok: true,
    source: params.attachment?.name ?? url,
    mediaType,
    url,
    model,
    styleSpec,
  };
}

export async function analyzeVisualReferenceById(params: {
  attachmentId: string;
  userId: string;
  question?: string | undefined;
}) {
  const rows = await loadOwnedAttachments([params.attachmentId], params.userId);
  const row = rows[0];
  if (!row) throw new Error("Pièce jointe introuvable ou inaccessible pour ce compte.");
  if (!row.mime_type.startsWith("image/") && !row.mime_type.startsWith("video/")) {
    throw new Error(`Le fichier « ${row.name} » (${row.mime_type}) n'est ni une image ni une vidéo.`);
  }
  return analyzeVisualReference({ attachment: row, question: params.question });
}

/**
 * Génération d'image guidée par des références visuelles réelles :
 * les images/photogrammes sont transmis au modèle avec le prompt, ce qui
 * reproduit la palette, le cadrage et la typographie de la source.
 */
export async function generateImageFromReferences(params: {
  prompt: string;
  referenceUrls: string[];
  styleSpec?: string | undefined;
}): Promise<StoredAsset> {
  const key = requireGatewayKey();
  if (params.referenceUrls.length === 0) {
    throw new Error("Aucune référence visuelle fournie pour cette génération.");
  }

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: [
        "Génère une image qui reprend fidèlement le style des références fournies (palette, lumière, cadrage, typographie).",
        params.styleSpec ? `Fiche de style à respecter :\n${params.styleSpec}` : "",
        `Demande : ${params.prompt}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    ...params.referenceUrls.slice(0, 4).map((url) => ({ type: "image_url", image_url: { url } })),
  ];

  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: optionalEnv("LOVABLE_IMAGE_MODEL") ?? "google/gemini-3-pro-image",
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Génération guidée [${res.status}] ${text.slice(0, 400)}`);

  const payload = JSON.parse(text) as {
    choices?: Array<{
      message?: {
        images?: Array<{ image_url?: { url?: string } }>;
        content?: string;
      };
    }>;
  };
  const raw = payload.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!raw) throw new Error("Le modèle n'a renvoyé aucune image.");
  const match = /^data:([^;]+);base64,(.+)$/.exec(raw);
  const bytes = match ? b64ToBytes(match[2]!) : new Uint8Array(await (await fetch(raw)).arrayBuffer());
  const mimeType = match?.[1] ?? "image/png";

  return storeAsset({
    kind: "image",
    data: bytes,
    mimeType,
    provider: "lovable (référence visuelle)",
    prompt: params.prompt,
    metadata: { references: params.referenceUrls.length },
  });
}

/** Résout des pièces jointes image/vidéo en URL signées utilisables comme références. */
export async function resolveReferenceUrls(attachmentIds: string[], userId: string) {
  const rows = await loadOwnedAttachments(attachmentIds, userId);
  const urls: string[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    if (row.mime_type.startsWith("image/")) {
      urls.push(await signedAttachmentUrl(row.storage_path));
    } else {
      skipped.push(`${row.name} (${row.mime_type})`);
    }
  }
  return { urls, skipped };
}
