import { storeAsset, type StoredAsset } from "./storage.server";
import { optionalEnv, withFallback } from "./errors.server";
import { downloadBytes, replicateRun } from "./replicate.server";
import { deapiMusic, deapiSpeech } from "./deapi.server";

/** DeAPI (Kokoro) — voix principale. */
async function deapiTts(text: string, voiceId?: string) {
  if (!optionalEnv("DEAPI_API_KEY")) throw new Error("DEAPI_API_KEY absente");
  return deapiSpeech({ text, ...(voiceId ? { voice: voiceId } : {}) });
}


const ELEVEN_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // Rachel

/** ElevenLabs — synthèse vocale. */
async function elevenTts(text: string, voiceId?: string) {
  const key = optionalEnv("ELEVENLABS_API_KEY");
  if (!key) throw new Error("ELEVENLABS_API_KEY absente");
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId || ELEVEN_DEFAULT_VOICE}`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.45, similarity_boost: 0.8 },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs [${res.status}] ${(await res.text()).slice(0, 400)}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: "audio/mpeg" };
}

/**
 * Kokoro (projet open source kokoro-web) :
 * 1. serveur auto-hébergé compatible OpenAI (KOKORO_API_URL, ex. déploiement de
 *    https://github.com/eduardolat/kokoro-web) ;
 * 2. sinon le modèle Kokoro-82M hébergé chez Replicate ;
 * 3. sinon Hugging Face (hexgrad/Kokoro-82M).
 */
async function kokoroTts(text: string, voiceId?: string) {
  const base = optionalEnv("KOKORO_API_URL");
  if (base) {
    const root = base.replace(/\/$/, "").replace(/\/v1$/, "");
    const res = await fetch(`${root}/v1/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(optionalEnv("KOKORO_API_KEY")
          ? { Authorization: `Bearer ${optionalEnv("KOKORO_API_KEY")}` }
          : {}),
      },
      body: JSON.stringify({
        model: optionalEnv("KOKORO_MODEL") ?? "model_q8f16",
        input: text,
        voice: voiceId || "af_heart",
        response_format: "mp3",
      }),
    });
    if (!res.ok) throw new Error(`Kokoro auto-hébergé [${res.status}] ${(await res.text()).slice(0, 300)}`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: "audio/mpeg" };
  }

  if (optionalEnv("REPLICATE_API_TOKEN")) {
    try {
      const url = await replicateRun(optionalEnv("REPLICATE_KOKORO_MODEL") ?? "jaaari/kokoro-82m", {
        text,
        voice: voiceId || "af_bella",
        speed: 1,
      });
      return downloadBytes(url, "audio/wav");
    } catch (error) {
      if (!optionalEnv("HF_TOKEN")) throw error;
    }
  }

  const token = optionalEnv("HF_TOKEN");
  if (!token) throw new Error("Aucun moteur Kokoro disponible (KOKORO_API_URL, REPLICATE_API_TOKEN ou HF_TOKEN)");
  const { InferenceClient } = await import("@huggingface/inference");
  const blob = (await new InferenceClient(token).textToSpeech({
    model: optionalEnv("HF_TTS_MODEL") ?? "hexgrad/Kokoro-82M",
    inputs: text,
  })) as unknown as Blob;
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType: blob.type || "audio/wav",
  };
}



/** Piper (serveur auto-hébergé, URL configurable). */
async function piperTts(text: string, voiceId?: string) {
  const base = optionalEnv("PIPER_API_URL");
  if (!base) throw new Error("PIPER_API_URL absente (serveur Piper non déployé)");
  const res = await fetch(`${base.replace(/\/$/, "")}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: voiceId || "fr_FR-siwis-medium" }),
  });
  if (!res.ok) throw new Error(`Piper [${res.status}] ${(await res.text()).slice(0, 300)}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: "audio/wav" };
}

/** Passerelle Lovable AI — voix intégrée, aucune clé fournisseur à saisir. */
async function lovableTts(text: string, voiceId?: string) {
  const key = optionalEnv("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY absente");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini-tts",
      input: text,
      voice: voiceId && /^[a-z]+$/.test(voiceId) ? voiceId : "alloy",
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`Passerelle Lovable [${res.status}] ${(await res.text()).slice(0, 400)}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: "audio/mpeg" };
}

const TTS: Record<string, (t: string, v?: string) => Promise<{ bytes: Uint8Array; mimeType: string }>> = {
  elevenlabs: elevenTts,
  kokoro: kokoroTts,
  piper: piperTts,
  lovable: lovableTts,
};

const TTS_ORDER = ["elevenlabs", "kokoro", "piper", "lovable"];

export const TTS_PROVIDERS = Object.keys(TTS);


export async function synthesizeSpeech(params: {
  text: string;
  voiceId?: string;
  provider?: string;
}): Promise<StoredAsset> {
  const order =
    params.provider && params.provider !== "auto" ? [params.provider] : TTS_ORDER;
  const result = await withFallback(
    "la synthèse vocale",
    order.filter((n) => TTS[n]).map((name) => ({ name, run: () => TTS[name]!(params.text, params.voiceId) })),
  );
  return storeAsset({
    kind: "audio",
    data: result.bytes,
    mimeType: result.mimeType,
    provider: result.provider,
    prompt: params.text.slice(0, 500),
  });
}

/** Podcast multi-voix : chaque réplique est réellement synthétisée puis assemblée. */
export async function synthesizePodcast(params: {
  title: string;
  segments: Array<{ speaker: string; voiceId?: string; text: string }>;
  provider?: string;
}): Promise<StoredAsset & { segments: number }> {
  if (params.segments.length === 0) throw new Error("Le podcast doit contenir au moins une réplique.");
  const order =
    params.provider && params.provider !== "auto" ? [params.provider] : TTS_ORDER;

  const chunks: Uint8Array[] = [];
  let usedProvider = "";
  let mimeType = "audio/mpeg";
  for (const seg of params.segments) {
    const res = await withFallback(
      `la voix de « ${seg.speaker} »`,
      order.filter((n) => TTS[n]).map((name) => ({ name, run: () => TTS[name]!(seg.text, seg.voiceId) })),
    );
    chunks.push(res.bytes);
    usedProvider = res.provider;
    mimeType = res.mimeType;
  }

  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }

  const asset = await storeAsset({
    kind: "audio",
    data: merged,
    mimeType,
    provider: usedProvider,
    prompt: params.title,
    metadata: { podcast: true, segments: params.segments.length },
  });
  return { ...asset, segments: params.segments.length };
}

/** Musique — Hugging Face (Stable Audio / MusicGen) puis Replicate, modèles configurables. */
export async function generateMusic(params: {
  prompt: string;
  provider?: string;
  durationSeconds?: number;
}): Promise<StoredAsset> {
  const seconds = Math.min(60, Math.max(5, Math.round(params.durationSeconds ?? 15)));

  const hf = async () => {
    const token = optionalEnv("HF_TOKEN");
    if (!token) throw new Error("HF_TOKEN absente");
    const model = optionalEnv("HF_MUSIC_MODEL") ?? "stabilityai/stable-audio-3-medium";
    const { InferenceClient } = await import("@huggingface/inference");
    // Tâche « text-to-audio » avec routage automatique vers un fournisseur qui sert le modèle.
    const client = new InferenceClient(token) as unknown as {
      textToAudio: (a: Record<string, unknown>) => Promise<Blob>;
    };
    const blob = await client.textToAudio({
      model,
      provider: "auto",
      inputs: params.prompt,
      parameters: { seconds_total: seconds },
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength < 1000) throw new Error("Hugging Face a renvoyé un fichier audio vide");
    return { bytes, mimeType: blob.type || "audio/wav" };
  };

  const elevenlabs = async () => {
    const key = optionalEnv("ELEVENLABS_API_KEY");
    if (!key) throw new Error("ELEVENLABS_API_KEY absente");
    const res = await fetch("https://api.elevenlabs.io/v1/music", {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: params.prompt, music_length_ms: seconds * 1000 }),
    });
    if (!res.ok) throw new Error(`ElevenLabs [${res.status}] ${(await res.text()).slice(0, 300)}`);
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mimeType: res.headers.get("content-type")?.split(";")[0] || "audio/mpeg",
    };
  };

  const replicate = async () => {
    const model = optionalEnv("REPLICATE_MUSIC_MODEL") ?? "meta/musicgen";
    const url = await replicateRun(model, {
      prompt: params.prompt,
      duration: seconds,
      output_format: "wav",
    });
    return downloadBytes(url, "audio/wav");
  };

  const map: Record<string, () => Promise<{ bytes: Uint8Array; mimeType: string }>> = {
    elevenlabs,
    huggingface: hf,
    replicate,
  };
  const order =
    params.provider && params.provider !== "auto"
      ? [params.provider]
      : ["elevenlabs", "huggingface", "replicate"];

  const result = await withFallback(
    "la génération de musique",
    order.filter((n) => map[n]).map((name) => ({ name, run: map[name]! })),
  );
  return storeAsset({
    kind: "audio",
    data: result.bytes,
    mimeType: result.mimeType,
    provider: result.provider,
    prompt: params.prompt,
    metadata: { music: true },
  });
}

