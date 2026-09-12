import { b64ToBytes, storeAsset, type StoredAsset } from "./storage.server";
import { optionalEnv, withFallback } from "./errors.server";

type Gen = { prompt: string; size?: string; provider?: string };

/** OpenAI Images (gpt-image-2, repli gpt-image-1). */
async function openaiImage({ prompt, size }: Gen) {
  const key = optionalEnv("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY absente");
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: key });

  let b64: string | undefined;
  for (const model of ["gpt-image-2", "gpt-image-1"]) {
    try {
      const res = await client.images.generate({
        model,
        prompt,
        size: (size as "1024x1024") ?? "1024x1024",
      });
      b64 = res.data?.[0]?.b64_json;
      if (b64) break;
    } catch (error) {
      if (model === "gpt-image-1") throw error;
    }
  }
  if (!b64) throw new Error("OpenAI n'a renvoyé aucune image");
  return { bytes: b64ToBytes(b64), mimeType: "image/png" };
}

/** Google Gemini image generation (clé GEMINI_API_KEY). */
async function geminiImage({ prompt }: Gen) {
  const key = optionalEnv("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY absente");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`[${res.status}] ${text.slice(0, 400)}`);
  const data = JSON.parse(text) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string; mimeType: string } }> } }>;
  };
  const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!inline) throw new Error("Gemini n'a renvoyé aucune image");
  return { bytes: b64ToBytes(inline.data), mimeType: inline.mimeType || "image/png" };
}

/** Hugging Face Inference (modèle configurable). */
async function hfImage({ prompt }: Gen) {
  const token = optionalEnv("HF_TOKEN");
  if (!token) throw new Error("HF_TOKEN absente");
  const { InferenceClient } = await import("@huggingface/inference");
  const client = new InferenceClient(token);
  const blob = await client.textToImage({
    model: optionalEnv("HF_IMAGE_MODEL") ?? "black-forest-labs/FLUX.1-schnell",
    inputs: prompt,
  });
  const buf = new Uint8Array(await (blob as unknown as Blob).arrayBuffer());
  return { bytes: buf, mimeType: "image/png" };
}

/** Passerelle Lovable AI (aucune clé fournisseur à saisir). */
async function lovableImage({ prompt }: Gen) {
  const key = optionalEnv("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY absente");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "google/gemini-3-pro-image",
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Passerelle Lovable [${res.status}] ${text.slice(0, 400)}`);
  const data = JSON.parse(text) as { data?: Array<{ b64_json?: string }> };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("La passerelle n'a renvoyé aucune image");
  return { bytes: b64ToBytes(b64), mimeType: "image/png" };
}

const PROVIDERS: Record<string, (g: Gen) => Promise<{ bytes: Uint8Array; mimeType: string }>> = {
  openai: openaiImage,
  gemini: geminiImage,
  huggingface: hfImage,
  lovable: lovableImage,
};

export const IMAGE_PROVIDERS = Object.keys(PROVIDERS);

export async function generateImage(gen: Gen): Promise<StoredAsset & { fallbacks?: unknown }> {
  const order =
    gen.provider && gen.provider !== "auto"
      ? [gen.provider, ...["openai", "gemini", "huggingface", "lovable"].filter((p) => p !== gen.provider)]
      : ["openai", "gemini", "huggingface", "lovable"];

  const result = await withFallback(
    "la génération d'image",
    order
      .filter((n) => PROVIDERS[n])
      .map((name) => ({ name, run: () => PROVIDERS[name]!(gen) })),
  );
  const asset = await storeAsset({
    kind: "image",
    data: result.bytes,
    mimeType: result.mimeType,
    provider: result.provider,
    prompt: gen.prompt,
  });
  return { ...asset, ...(result.fallbacks ? { fallbacks: result.fallbacks } : {}) };
}
