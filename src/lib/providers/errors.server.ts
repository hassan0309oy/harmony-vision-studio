/** Shared helpers so every capability reports precisely what is missing and why. */

export class MissingConfigError extends Error {
  constructor(
    public readonly key: string,
    public readonly capability: string,
  ) {
    super(
      `Configuration manquante : la clé « ${key} » n'est pas définie, donc ${capability} ne peut pas s'exécuter. Ajoutez-la dans les secrets du projet.`,
    );
  }
}

export function requireEnv(key: string, capability: string): string {
  const value = process.env[key];
  if (!value) throw new MissingConfigError(key, capability);
  return value;
}

export function optionalEnv(key: string): string | undefined {
  return process.env[key] || undefined;
}

export type ProviderAttempt = { provider: string; error: string };

/**
 * Run each provider in order until one succeeds. Every failure is reported —
 * no silent fallback, no simulated result.
 */
export async function withFallback<T>(
  capability: string,
  providers: Array<{ name: string; run: () => Promise<T> }>,
): Promise<T & { provider: string; fallbacks?: ProviderAttempt[] }> {
  const attempts: ProviderAttempt[] = [];
  if (providers.length === 0) {
    throw new Error(`Aucun fournisseur disponible pour ${capability}.`);
  }
  for (const p of providers) {
    try {
      const result = await p.run();
      return {
        ...(result as T),
        provider: p.name,
        ...(attempts.length ? { fallbacks: attempts } : {}),
      };
    } catch (error) {
      attempts.push({
        provider: p.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  throw new Error(
    `${capability} a échoué chez tous les fournisseurs :\n` +
      attempts.map((a) => `- ${a.provider} : ${a.error}`).join("\n"),
  );
}

export async function httpJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`[${res.status}] ${text.slice(0, 600)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Réponse non JSON : ${text.slice(0, 300)}`);
  }
}
