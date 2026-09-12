import { storeAsset, type StoredAsset } from "./storage.server";
import { httpJson, optionalEnv, withFallback } from "./errors.server";
import { downloadBytes, replicateRun } from "./replicate.server";

type Gen = { prompt: string; provider?: string; durationSeconds?: number };

const RUNWAY_VERSION = "2024-11-06";

/** Runway text-to-video (poll jusqu'à obtention du fichier). */
async function runwayVideo({ prompt, durationSeconds }: Gen) {
  const key = optionalEnv("RUNWAY_API_KEY");
  if (!key) throw new Error("RUNWAY_API_KEY absente");
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "X-Runway-Version": RUNWAY_VERSION,
  };

  // veo3 a été retiré par Runway : veo3.1 n'accepte que des clips de 8 secondes.
  const model = optionalEnv("RUNWAY_VIDEO_MODEL") ?? "veo3.1";
  const duration = model.startsWith("veo") ? 8 : (durationSeconds ?? 8);

  const task = await httpJson<{ id: string }>("https://api.dev.runwayml.com/v1/text_to_video", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      promptText: prompt,
      ratio: optionalEnv("RUNWAY_VIDEO_RATIO") ?? "1280:720",
      duration,
    }),
  });

  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const status = await httpJson<{
      status: string;
      output?: string[];
      failure?: string;
      failureCode?: string;
    }>(`https://api.dev.runwayml.com/v1/tasks/${task.id}`, { headers });
    if (status.status === "SUCCEEDED" && status.output?.[0]) {
      return downloadBytes(status.output[0], "video/mp4");
    }
    if (status.status === "FAILED") {
      throw new Error(`Runway a échoué : ${status.failure ?? status.failureCode ?? "raison inconnue"}`);
    }
  }
  throw new Error("Runway : délai dépassé (plus de 8 minutes)");
}

/** Replicate, fournisseur interchangeable. */
async function replicateVideo({ prompt }: Gen) {
  const model = optionalEnv("REPLICATE_VIDEO_MODEL") ?? "minimax/video-01";
  const url = await replicateRun(model, { prompt });
  return downloadBytes(url, "video/mp4");
}

/** Passerelle Lovable AI — vidéo intégrée, aucune clé fournisseur externe requise. */
async function lovableVideo({ prompt, durationSeconds }: Gen) {
  const key = optionalEnv("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY absente");
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const seconds = Math.min(10, Math.max(3, Math.round(durationSeconds ?? 8)));

  const job = await httpJson<{ id: string }>("https://ai.gateway.lovable.dev/v1/videos", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: optionalEnv("LOVABLE_VIDEO_MODEL") ?? "google/gemini-omni-1.1-flash",
      input: prompt,
      response_format: { type: "video", resolution: "720p", duration: `${seconds}s` },
    }),
  });

  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 6000));
    const status = await httpJson<{ status: string; error?: { message?: string } }>(
      `https://ai.gateway.lovable.dev/v1/videos/${job.id}`,
      { headers },
    );
    if (status.status === "completed") {
      const file = await fetch(`https://ai.gateway.lovable.dev/v1/videos/${job.id}/content`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!file.ok) throw new Error(`Téléchargement de la vidéo échoué [${file.status}]`);
      return { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: "video/mp4" };
    }
    if (status.status === "failed") {
      throw new Error(status.error?.message ?? "génération refusée par la passerelle");
    }
  }
  throw new Error("Passerelle Lovable : délai dépassé");
}

const PROVIDERS: Record<string, (g: Gen) => Promise<{ bytes: Uint8Array; mimeType: string }>> = {
  lovable: lovableVideo,
  runway: runwayVideo,
  replicate: replicateVideo,
};

export const VIDEO_PROVIDERS = Object.keys(PROVIDERS);

export async function generateVideo(gen: Gen): Promise<StoredAsset> {
  const order =
    gen.provider && gen.provider !== "auto" ? [gen.provider] : ["lovable", "runway", "replicate"];
  const result = await withFallback(
    "la génération de vidéo",
    order.filter((n) => PROVIDERS[n]).map((name) => ({ name, run: () => PROVIDERS[name]!(gen) })),
  );
  return storeAsset({
    kind: "video",
    data: result.bytes,
    mimeType: result.mimeType,
    provider: result.provider,
    prompt: gen.prompt,
  });
}
