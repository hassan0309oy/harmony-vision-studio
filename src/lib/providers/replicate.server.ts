import { optionalEnv } from "./errors.server";

/**
 * Lance un modèle Replicate et attend le résultat.
 * Accepte « owner/name » (dernière version publique) ou un hash de version.
 */
export async function replicateRun(
  modelRef: string,
  input: Record<string, unknown>,
  timeoutMs = 8 * 60 * 1000,
): Promise<string> {
  const key = optionalEnv("REPLICATE_API_TOKEN");
  if (!key) throw new Error("REPLICATE_API_TOKEN absente");
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  const isVersionHash = /^[0-9a-f]{40,}$/i.test(modelRef);
  const [refBeforeColon, versionAfterColon] = modelRef.split(":");

  async function create(url: string, body: unknown) {
    // Limite de débit Replicate (429) : on patiente le délai indiqué, jusqu'à 3 essais.
    for (let i = 0; ; i++) {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      const text = await res.text();
      if (res.status === 429 && i < 3) {
        const wait = Number(res.headers.get("retry-after")) || 12;
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      return { ok: res.ok, status: res.status, text };
    }
  }


  let attempt = isVersionHash
    ? await create("https://api.replicate.com/v1/predictions", { version: modelRef, input })
    : versionAfterColon
      ? await create("https://api.replicate.com/v1/predictions", { version: versionAfterColon, input })
      : await create(`https://api.replicate.com/v1/models/${refBeforeColon}/predictions`, { input });

  // Les modèles communautaires n'exposent pas l'endpoint « /models/... » :
  // on récupère alors la dernière version publiée et on relance.
  if (!attempt.ok && attempt.status === 404 && !isVersionHash && !versionAfterColon) {
    const infoRes = await fetch(`https://api.replicate.com/v1/models/${refBeforeColon}`, { headers });
    const info = (await infoRes.json()) as { latest_version?: { id?: string }; detail?: string };
    const version = info.latest_version?.id;
    if (!version) throw new Error(`Replicate : modèle « ${modelRef} » introuvable`);
    attempt = await create("https://api.replicate.com/v1/predictions", { version, input });
  }

  if (!attempt.ok) throw new Error(`Replicate [${attempt.status}] ${attempt.text.slice(0, 400)}`);
  const created = JSON.parse(attempt.text) as { id?: string; detail?: string };
  if (!created.id) throw new Error(created.detail ?? "Replicate a refusé la demande");


  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const res = await fetch(`https://api.replicate.com/v1/predictions/${created.id}`, { headers });
    const status = (await res.json()) as {
      status: string;
      output?: string | string[] | { url?: string };
      error?: string;
    };
    if (status.status === "succeeded") {
      const out = status.output;
      const outUrl =
        typeof out === "string"
          ? out
          : Array.isArray(out)
            ? out[0]
            : typeof out === "object" && out
              ? out.url
              : undefined;
      if (!outUrl) throw new Error("Replicate n'a renvoyé aucun fichier");
      return outUrl;
    }
    if (status.status === "failed" || status.status === "canceled") {
      throw new Error(`Replicate a échoué : ${status.error ?? status.status}`);
    }
  }
  throw new Error("Replicate : délai dépassé");
}

export async function downloadBytes(url: string, fallbackMime: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Téléchargement du fichier échoué [${res.status}]`);
  const mime = res.headers.get("content-type")?.split(";")[0] || fallbackMime;
  return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: mime };
}
