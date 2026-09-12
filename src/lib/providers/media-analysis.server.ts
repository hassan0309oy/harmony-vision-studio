import { supabaseAdmin } from "@/integrations/supabase/client.server";

import {
  downloadAttachment,
  loadOwnedAttachments,
  safeFileName,
  signedAttachmentUrl,
  type AttachmentRow,
} from "./attachments.server";

const MEDIA_BUCKET = "media";
const MAX_REMOTE_BYTES = 120 * 1024 * 1024;
const METADATA_PARSE_LIMIT = 90 * 1024 * 1024;

export type Mp4Metadata = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  frameCount: number | null;
};

/* ------------------------------------------------------------------ */
/* Métadonnées réelles lues dans le conteneur MP4/MOV (pas d'estimation) */
/* ------------------------------------------------------------------ */

function u32(b: Uint8Array, o: number) {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}
function u16(b: Uint8Array, o: number) {
  return (b[o]! << 8) | b[o + 1]!;
}

type Box = { type: string; start: number; end: number };

function boxes(b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = u32(b, offset);
    const type = String.fromCharCode(b[offset + 4]!, b[offset + 5]!, b[offset + 6]!, b[offset + 7]!);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      const high = u32(b, offset + 8);
      const low = u32(b, offset + 12);
      size = high * 2 ** 32 + low;
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    out.push({ type, start: offset + header, end: offset + size });
    offset += size;
  }
  return out;
}

function find(list: Box[], type: string) {
  return list.find((box) => box.type === type);
}

export function parseMp4Metadata(bytes: Uint8Array): Mp4Metadata {
  const empty: Mp4Metadata = {
    durationSeconds: null,
    width: null,
    height: null,
    fps: null,
    frameCount: null,
  };
  try {
    const top = boxes(bytes, 0, bytes.length);
    const moov = find(top, "moov");
    if (!moov) return empty;
    const moovBoxes = boxes(bytes, moov.start, moov.end);

    let durationSeconds: number | null = null;
    const mvhd = find(moovBoxes, "mvhd");
    if (mvhd) {
      const version = bytes[mvhd.start]!;
      const base = mvhd.start + (version === 1 ? 20 : 12);
      const timescale = version === 1 ? u32(bytes, mvhd.start + 20) : u32(bytes, mvhd.start + 12);
      const duration =
        version === 1
          ? u32(bytes, base + 8) * 2 ** 32 + u32(bytes, base + 12)
          : u32(bytes, base + 4);
      if (timescale > 0) durationSeconds = duration / timescale;
    }

    let width: number | null = null;
    let height: number | null = null;
    let fps: number | null = null;
    let frameCount: number | null = null;

    for (const trak of moovBoxes.filter((box) => box.type === "trak")) {
      const trakBoxes = boxes(bytes, trak.start, trak.end);
      const tkhd = find(trakBoxes, "tkhd");
      const mdia = find(trakBoxes, "mdia");
      if (!mdia) continue;
      const mdiaBoxes = boxes(bytes, mdia.start, mdia.end);
      const hdlr = find(mdiaBoxes, "hdlr");
      const handler = hdlr
        ? String.fromCharCode(
            bytes[hdlr.start + 8]!,
            bytes[hdlr.start + 9]!,
            bytes[hdlr.start + 10]!,
            bytes[hdlr.start + 11]!,
          )
        : "";
      if (handler !== "vide") continue;

      if (tkhd) {
        const version = bytes[tkhd.start]!;
        const end = tkhd.end;
        width = u16(bytes, end - 8);
        height = u16(bytes, end - 4);
        if (version === 1 && (!width || !height)) {
          width = null;
          height = null;
        }
      }

      const mdhd = find(mdiaBoxes, "mdhd");
      let trackTimescale = 0;
      let trackDuration = 0;
      if (mdhd) {
        const version = bytes[mdhd.start]!;
        if (version === 1) {
          trackTimescale = u32(bytes, mdhd.start + 20);
          trackDuration = u32(bytes, mdhd.start + 24) * 2 ** 32 + u32(bytes, mdhd.start + 28);
        } else {
          trackTimescale = u32(bytes, mdhd.start + 12);
          trackDuration = u32(bytes, mdhd.start + 16);
        }
      }

      const minf = find(mdiaBoxes, "minf");
      const stbl = minf ? find(boxes(bytes, minf.start, minf.end), "stbl") : undefined;
      if (stbl) {
        const stblBoxes = boxes(bytes, stbl.start, stbl.end);
        const stsz = find(stblBoxes, "stsz");
        if (stsz) frameCount = u32(bytes, stsz.start + 8);
      }
      if (frameCount && trackTimescale > 0 && trackDuration > 0) {
        fps = Number((frameCount / (trackDuration / trackTimescale)).toFixed(3));
      }
      break;
    }

    return { durationSeconds, width, height, fps, frameCount };
  } catch {
    return empty;
  }
}

export function formatTimecode(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Résolution des sources (fichier joint, URL directe, Google Drive)    */
/* ------------------------------------------------------------------ */

export function driveFileId(url: string): string | null {
  const patterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{10,})/,
    /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]{10,})/,
    /drive\.google\.com\/uc\?[^ ]*id=([a-zA-Z0-9_-]{10,})/,
    /docs\.google\.com\/[^ ]*\/d\/([a-zA-Z0-9_-]{10,})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1]!;
  }
  return null;
}

export type ResolvedMedia = {
  url: string;
  mimeType: string;
  bytes: Uint8Array | null;
  size: number;
  source: string;
  name: string;
};

async function storeRemote(bytes: Uint8Array, mimeType: string, name: string) {
  const path = `remote/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeFileName(name)}`;
  const upload = await supabaseAdmin.storage.from(MEDIA_BUCKET).upload(path, bytes, {
    contentType: mimeType,
    upsert: true,
  });
  if (upload.error) throw new Error(`Enregistrement impossible : ${upload.error.message}`);
  const signed = await supabaseAdmin.storage.from(MEDIA_BUCKET).createSignedUrl(path, 60 * 60 * 6);
  if (signed.error || !signed.data) throw new Error("Lien de média indisponible.");
  await supabaseAdmin.from("media_assets").insert({
    kind: mimeType.startsWith("video/") ? "video" : "media",
    storage_path: path,
    mime_type: mimeType,
    provider: "import",
    prompt: null,
    metadata: {} as never,
  });
  return signed.data.signedUrl;
}

/** Télécharge réellement le média. Lève une erreur explicite si l'accès est refusé. */
export async function resolveMediaSource(params: {
  attachment?: AttachmentRow | undefined;
  url?: string | undefined;
}): Promise<ResolvedMedia> {
  if (params.attachment) {
    const row = params.attachment;
    const url = await signedAttachmentUrl(row.storage_path);
    const bytes =
      row.size <= METADATA_PARSE_LIMIT ? await downloadAttachment(row.storage_path) : null;
    return {
      url,
      mimeType: row.mime_type,
      bytes,
      size: row.size,
      source: `pièce jointe « ${row.name} »`,
      name: row.name,
    };
  }

  const raw = params.url?.trim();
  if (!raw) throw new Error("Aucune source média fournie.");

  const driveId = driveFileId(raw);
  const targets = driveId
    ? [
        `https://drive.google.com/uc?export=download&id=${driveId}`,
        `https://drive.usercontent.google.com/download?id=${driveId}&export=download&confirm=t`,
      ]
    : [raw];

  let lastProblem = "";
  for (const target of targets) {
    let response: Response;
    try {
      response = await fetch(target, { redirect: "follow" });
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
      continue;
    }
    if (!response.ok) {
      lastProblem = `HTTP ${response.status}`;
      continue;
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (contentType.startsWith("text/html")) {
      lastProblem = driveId
        ? "Google Drive renvoie une page HTML : le fichier n'est pas partagé publiquement."
        : "L'URL renvoie une page HTML et non un fichier média.";
      continue;
    }
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_REMOTE_BYTES) {
      throw new Error(
        `Le média fait ${(length / 1048576).toFixed(1)} Mo, au-delà de la limite de 120 Mo.`,
      );
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength === 0) {
      lastProblem = "Le fichier téléchargé est vide.";
      continue;
    }
    if (buffer.byteLength > MAX_REMOTE_BYTES) {
      throw new Error(
        `Le média fait ${(buffer.byteLength / 1048576).toFixed(1)} Mo, au-delà de la limite de 120 Mo.`,
      );
    }
    const name = decodeURIComponent(new URL(target).pathname.split("/").pop() || "media");
    const mimeType = contentType || "video/mp4";
    const storedUrl = await storeRemote(buffer, mimeType, name);
    return {
      url: storedUrl,
      mimeType,
      bytes: buffer.byteLength <= METADATA_PARSE_LIMIT ? buffer : null,
      size: buffer.byteLength,
      source: driveId ? `Google Drive (${driveId})` : raw,
      name,
    };
  }

  if (driveId) {
    throw new Error(
      `Accès refusé au fichier Google Drive ${driveId} (${lastProblem}). Le fichier doit être partagé avec l'option « Tous les utilisateurs disposant du lien » pour être réellement téléchargé. Aucune analyse n'a été effectuée.`,
    );
  }
  throw new Error(`Impossible de récupérer le média : ${lastProblem || "accès refusé"}.`);
}

/* ------------------------------------------------------------------ */
/* Analyse multimodale réelle via la passerelle IA                      */
/* ------------------------------------------------------------------ */

const VIDEO_MODELS = ["google/gemini-3.8-flash", "google/gemini-3.7-flash", "google/gemini-3.1-pro-preview"];

const ANALYSIS_PROMPT = `Tu es un analyste vidéo professionnel. Analyse la vidéo fournie de façon factuelle, uniquement à partir de ce que tu observes et entends réellement.

Rends un rapport markdown avec exactement ces sections :
1. **Chronologie** : une ligne par segment au format \`MM:SS–MM:SS — description\` (plans, coupes, transitions, mouvements de caméra, texte à l'écran).
2. **Changements de plans** : nombre observé et timecodes des coupes.
3. **Transitions** : type (cut, fondu, glissé, zoom…) et timecode.
4. **Analyse audio** : musique (style, instruments), voix/dialogues (transcription des passages clés avec timecodes), bruitages, claps/beats marquants avec timecodes.
5. **Rythme** : tempo perçu (lent/modéré/rapide), régularité, synchronisation image/son, estimation de BPM si la musique le permet.
6. **Moments importants** : timecodes et raison.
7. **Résumé global**.

Si un élément n'est pas perceptible, écris explicitement « non perceptible » plutôt que d'inventer.`;

export type MediaAnalysis = {
  ok: true;
  source: string;
  mimeType: string;
  sizeBytes: number;
  technical: Mp4Metadata & { durationLabel: string | null };
  model: string;
  analysis: string;
  notes: string[];
};

export async function analyzeMediaSource(params: {
  attachment?: AttachmentRow | undefined;
  url?: string | undefined;
  question?: string | undefined;
}): Promise<MediaAnalysis> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY absente : l'analyse multimodale est indisponible.");

  const media = await resolveMediaSource({ attachment: params.attachment, url: params.url });
  const isVideo = media.mimeType.startsWith("video/");
  const isAudio = media.mimeType.startsWith("audio/");
  if (!isVideo && !isAudio) {
    throw new Error(
      `Le fichier récupéré est de type ${media.mimeType} : ce n'est ni une vidéo ni un fichier audio.`,
    );
  }

  const notes: string[] = [];
  let technical: Mp4Metadata = {
    durationSeconds: null,
    width: null,
    height: null,
    fps: null,
    frameCount: null,
  };
  if (media.bytes && isVideo) {
    technical = parseMp4Metadata(media.bytes);
    if (technical.durationSeconds === null) {
      notes.push(
        "Métadonnées techniques non lisibles : le conteneur n'est pas au format MP4/MOV standard.",
      );
    }
  } else if (isVideo) {
    notes.push("Fichier trop volumineux pour la lecture des métadonnées du conteneur.");
  }

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `${ANALYSIS_PROMPT}\n\nDemande de l'utilisateur : ${params.question ?? "Analyse complète."}\n\nMétadonnées mesurées sur le fichier : ${JSON.stringify(technical)}`,
    },
  ];
  if (isVideo) {
    content.push({ type: "video_url", video_url: { url: media.url } });
  } else {
    const audioBytes: Uint8Array =
      media.bytes ?? new Uint8Array(await (await fetch(media.url)).arrayBuffer());
    let binary = "";
    for (let i = 0; i < audioBytes.length; i += 0x8000) {
      binary += String.fromCharCode(...audioBytes.subarray(i, i + 0x8000));
    }
    content.push({
      type: "input_audio",
      input_audio: { data: btoa(binary), format: media.mimeType.split("/")[1] ?? "mp3" },
    });
  }

  let lastError = "";
  for (const model of VIDEO_MODELS) {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({ model, messages: [{ role: "user", content }] }),
    });
    const text = await response.text();
    if (response.ok) {
      const payload = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const analysis = payload.choices?.[0]?.message?.content?.trim();
      if (!analysis) {
        lastError = "Réponse vide du modèle.";
        continue;
      }
      return {
        ok: true,
        source: media.source,
        mimeType: media.mimeType,
        sizeBytes: media.size,
        technical: {
          ...technical,
          durationLabel:
            technical.durationSeconds !== null ? formatTimecode(technical.durationSeconds) : null,
        },
        model,
        analysis,
        notes,
      };
    }
    lastError = `[${response.status}] ${text.slice(0, 300)}`;
    if (response.status === 402 || response.status === 403 || response.status === 401) break;
  }
  throw new Error(`Analyse multimodale échouée : ${lastError}`);
}

export async function analyzeAttachmentById(params: {
  attachmentId: string;
  userId: string;
  question?: string | undefined;
}) {
  const rows = await loadOwnedAttachments([params.attachmentId], params.userId);
  const row = rows[0];
  if (!row) throw new Error("Pièce jointe introuvable ou inaccessible pour ce compte.");
  return analyzeMediaSource({ attachment: row, question: params.question });
}
