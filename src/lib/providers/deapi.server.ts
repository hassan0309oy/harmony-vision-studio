/**
 * DeAPI (https://api.deapi.ai) — fournisseur unique couvrant image, vidéo,
 * voix, musique, transcription, retouche/agrandissement d'image et embeddings.
 *
 * Toutes les requêtes sont asynchrones : le POST renvoie un `request_id`, puis
 * on interroge /jobs/<id> jusqu'à obtenir `result_url`.
 */
import { requireEnv } from "./errors.server";

const BASE = "https://api.deapi.ai/api/v2";
const CAPABILITY = "les fonctions média DeAPI";

export const DEAPI_MODELS = {
  image: "Flux1schnell",
  imageAlt: "Flux_2_Klein_4B_BF16",
  imageEdit: "QwenImageEdit_Plus_NF4",
  upscale: "RealESRGAN_x4",
  removeBackground: "Ben2",
  video: "Ltx2_5_22B_Dist_INT8",
  videoAlt: "Ltxv_13B_0_9_8_Distilled_FP8",
  videoUpscale: "RealESRGAN_Vid_x2",
  speech: "Kokoro",
  music: "AceStep_1_5_Turbo",
  transcribe: "WhisperLargeV3",
  embedding: "Bge_M3_FP16",
} as const;

function apiKey() {
  return requireEnv("DEAPI_API_KEY", CAPABILITY);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** POST avec relance automatique sur limitation de débit. */
async function submit(path: string, body: BodyInit, json: boolean): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey()}`,
    accept: "application/json",
  };
  if (json) headers["Content-Type"] = "application/json";

  let last = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body });
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text) as { data?: { request_id?: string } };
      const id = data.data?.request_id;
      if (!id) throw new Error(`DeAPI n'a renvoyé aucun identifiant de tâche : ${text.slice(0, 300)}`);
      return id;
    }
    last = `[${res.status}] ${text.slice(0, 400)}`;
    if (res.status === 429 || /too many attempts/i.test(text)) {
      await sleep(4000 * (attempt + 1));
      continue;
    }
    throw new Error(`DeAPI ${path} ${last}`);
  }
  throw new Error(`DeAPI ${path} — limite de débit atteinte : ${last}`);
}

type JobResult = { resultUrl: string; metadata?: unknown };

async function waitForJob(requestId: string, timeoutMs = 10 * 60 * 1000): Promise<JobResult> {
  const headers = { Authorization: `Bearer ${apiKey()}`, accept: "application/json" };
  const deadline = Date.now() + timeoutMs;
  let delay = 3000;
  while (Date.now() < deadline) {
    await sleep(delay);
    delay = Math.min(8000, delay + 1000);
    const res = await fetch(`${BASE}/jobs/${requestId}`, { headers });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 429) continue;
      throw new Error(`DeAPI suivi de tâche [${res.status}] ${text.slice(0, 300)}`);
    }
    const job = (JSON.parse(text) as {
      data?: {
        status?: string;
        result_url?: string | null;
        error_reason?: string | null;
        error_code?: string | null;
        metadata?: unknown;
      };
    }).data;
    if (job?.status === "done" && job.result_url) {
      return { resultUrl: job.result_url, metadata: job.metadata };
    }
    if (job?.status === "failed" || job?.error_reason) {
      throw new Error(`DeAPI a échoué : ${job?.error_reason ?? job?.error_code ?? "raison inconnue"}`);
    }
  }
  throw new Error("DeAPI : délai dépassé pour cette génération.");
}

async function downloadResult(url: string, fallbackMime: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Téléchargement du résultat DeAPI impossible [${res.status}]`);
  const mime = res.headers.get("content-type")?.split(";")[0] || fallbackMime;
  return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: mime };
}

async function downloadJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`Résultat DeAPI illisible [${res.status}] ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

function blobOf(bytes: Uint8Array, mimeType: string) {
  return new Blob([bytes as unknown as BlobPart], { type: mimeType || "application/octet-stream" });
}

/** Arrondit à un multiple valide dans les bornes du modèle. */
function snap(value: number, step = 128, min = 256, max = 2048) {
  const v = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, v));
}

function parseSize(size?: string) {
  const match = size?.match(/^(\d+)\s*[x×]\s*(\d+)$/);
  if (!match) return { width: 1024, height: 1024 };
  return { width: snap(Number(match[1])), height: snap(Number(match[2])) };
}

/* ------------------------------- Images ------------------------------- */

export async function deapiGenerateImage(params: {
  prompt: string;
  size?: string;
  model?: string;
  steps?: number;
}) {
  const { width, height } = parseSize(params.size);
  const id = await submit(
    "/images/generations",
    JSON.stringify({
      model: params.model ?? DEAPI_MODELS.image,
      prompt: params.prompt,
      width,
      height,
      steps: params.steps ?? 4,
      seed: -1,
    }),
    true,
  );
  const job = await waitForJob(id, 5 * 60 * 1000);
  return downloadResult(job.resultUrl, "image/png");
}

export async function deapiEditImage(params: {
  imageBytes: Uint8Array;
  mimeType: string;
  prompt: string;
  fileName?: string;
  steps?: number;
}) {
  const form = new FormData();
  form.set("model", DEAPI_MODELS.imageEdit);
  form.set("prompt", params.prompt);
  form.set("steps", String(params.steps ?? 20));
  form.set("seed", "-1");
  form.set("image", blobOf(params.imageBytes, params.mimeType), params.fileName ?? "image.png");
  const id = await submit("/images/edits", form, false);
  const job = await waitForJob(id, 8 * 60 * 1000);
  return downloadResult(job.resultUrl, "image/png");
}

export async function deapiUpscaleImage(params: {
  imageBytes: Uint8Array;
  mimeType: string;
  fileName?: string;
}) {
  const form = new FormData();
  form.set("model", DEAPI_MODELS.upscale);
  form.set("image", blobOf(params.imageBytes, params.mimeType), params.fileName ?? "image.png");
  const id = await submit("/images/upscales", form, false);
  const job = await waitForJob(id, 8 * 60 * 1000);
  return downloadResult(job.resultUrl, "image/png");
}

export async function deapiRemoveBackground(params: {
  imageBytes: Uint8Array;
  mimeType: string;
  fileName?: string;
}) {
  const form = new FormData();
  form.set("model", DEAPI_MODELS.removeBackground);
  form.set("image", blobOf(params.imageBytes, params.mimeType), params.fileName ?? "image.png");
  const id = await submit("/images/edits", form, false);
  const job = await waitForJob(id, 8 * 60 * 1000);
  return downloadResult(job.resultUrl, "image/png");
}

/* -------------------------------- Vidéo -------------------------------- */

function videoDims(size?: string) {
  const { width, height } = parseSize(size ?? "768x768");
  return { width: Math.min(1280, width), height: Math.min(1280, height) };
}

export async function deapiGenerateVideo(params: {
  prompt: string;
  size?: string;
  durationSeconds?: number;
  fps?: number;
  model?: string;
}) {
  const fps = params.fps ?? 24;
  const seconds = Math.min(10, Math.max(2, Math.round(params.durationSeconds ?? 4)));
  const { width, height } = videoDims(params.size);
  const id = await submit(
    "/videos/generations",
    JSON.stringify({
      model: params.model ?? DEAPI_MODELS.video,
      prompt: params.prompt,
      width,
      height,
      frames: seconds * fps + 1,
      fps,
      seed: -1,
    }),
    true,
  );
  const job = await waitForJob(id);
  return downloadResult(job.resultUrl, "video/mp4");
}

/** Image → vidéo : l'image sert de première image de la séquence. */
export async function deapiImageToVideo(params: {
  imageBytes: Uint8Array;
  mimeType: string;
  prompt: string;
  size?: string;
  durationSeconds?: number;
  fps?: number;
  fileName?: string;
  model?: string;
}) {
  const fps = params.fps ?? 24;
  const seconds = Math.min(10, Math.max(2, Math.round(params.durationSeconds ?? 4)));
  const { width, height } = videoDims(params.size);
  const form = new FormData();
  form.set("model", params.model ?? DEAPI_MODELS.video);
  form.set("prompt", params.prompt);
  form.set("width", String(width));
  form.set("height", String(height));
  form.set("frames", String(seconds * fps + 1));
  form.set("fps", String(fps));
  form.set("seed", "-1");
  form.set("image", blobOf(params.imageBytes, params.mimeType), params.fileName ?? "image.png");
  const id = await submit("/videos/generations", form, false);
  const job = await waitForJob(id);
  return downloadResult(job.resultUrl, "video/mp4");
}

export async function deapiUpscaleVideo(params: {
  videoBytes: Uint8Array;
  mimeType: string;
  fileName?: string;
}) {
  const form = new FormData();
  form.set("model", DEAPI_MODELS.videoUpscale);
  form.set("video", blobOf(params.videoBytes, params.mimeType), params.fileName ?? "video.mp4");
  const id = await submit("/videos/upscales", form, false);
  const job = await waitForJob(id);
  return downloadResult(job.resultUrl, "video/mp4");
}

/* -------------------------------- Audio -------------------------------- */

export async function deapiSpeech(params: { text: string; voice?: string; model?: string }) {
  const id = await submit(
    "/audio/speech",
    JSON.stringify({
      model: params.model ?? DEAPI_MODELS.speech,
      text: params.text,
      voice: params.voice || "af_alloy",
      format: "mp3",
    }),
    true,
  );
  const job = await waitForJob(id, 6 * 60 * 1000);
  return downloadResult(job.resultUrl, "audio/mpeg");
}

export async function deapiMusic(params: { prompt: string; durationSeconds?: number }) {
  const duration = Math.min(120, Math.max(5, Math.round(params.durationSeconds ?? 20)));
  const id = await submit(
    "/audio/music",
    JSON.stringify({ model: DEAPI_MODELS.music, caption: params.prompt, duration }),
    true,
  );
  const job = await waitForJob(id, 8 * 60 * 1000);
  return downloadResult(job.resultUrl, "audio/mpeg");
}

export type DeapiTranscript = {
  text: string;
  segments?: Array<{ start?: number; end?: number; text?: string }>;
  language?: string;
};

/** Transcription d'un fichier audio/vidéo accessible par URL (ou YouTube). */
export async function deapiTranscribe(params: {
  sourceUrl: string;
  includeTimestamps?: boolean;
}): Promise<DeapiTranscript> {
  const id = await submit(
    "/audio/transcriptions",
    JSON.stringify({
      model: DEAPI_MODELS.transcribe,
      source_url: params.sourceUrl,
      include_ts: params.includeTimestamps ?? true,
    }),
    true,
  );
  const job = await waitForJob(id, 15 * 60 * 1000);
  const raw = await downloadJson<
    | DeapiTranscript
    | { transcription?: DeapiTranscript | string; result?: DeapiTranscript | string; text?: string }
  >(job.resultUrl);
  const candidate =
    (raw as { transcription?: unknown }).transcription ??
    (raw as { result?: unknown }).result ??
    raw;
  if (typeof candidate === "string") return { text: candidate };
  const obj = candidate as DeapiTranscript;
  return {
    text: obj.text ?? "",
    ...(obj.segments ? { segments: obj.segments } : {}),
    ...(obj.language ? { language: obj.language } : {}),
  };
}

/* ------------------------------ Embeddings ----------------------------- */

export async function deapiEmbeddings(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) throw new Error("Aucun texte à vectoriser.");
  const id = await submit(
    "/embeddings",
    JSON.stringify({ model: DEAPI_MODELS.embedding, input: inputs }),
    true,
  );
  const job = await waitForJob(id, 5 * 60 * 1000);
  const raw = await downloadJson<unknown>(job.resultUrl);

  const collect = (value: unknown): number[][] => {
    if (Array.isArray(value)) {
      if (value.every((v) => typeof v === "number")) return [value as number[]];
      return value.flatMap((v) => collect(v));
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const key of ["embeddings", "embedding", "data", "vectors", "result"]) {
        if (key in obj) return collect(obj[key]);
      }
    }
    return [];
  };

  const vectors = collect(raw);
  if (vectors.length === 0) throw new Error("DeAPI n'a renvoyé aucun vecteur.");
  return vectors;
}
