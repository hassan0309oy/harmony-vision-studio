import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const PREFERENCE_KEYS = [
  "provider_image",
  "provider_video",
  "provider_audio",
  "provider_memory",
  "chat_model",
] as const;

export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

/** Lit toutes les préférences de fournisseurs enregistrées. */
export async function readPreferences(): Promise<Record<string, string>> {
  const rows = await supabaseAdmin.from("app_preferences").select("key, value");
  if (rows.error) return {};
  const out: Record<string, string> = {};
  for (const row of rows.data ?? []) out[row.key] = row.value;
  return out;
}

/** Fournisseur choisi manuellement pour un type de production ("auto" si non défini). */
export async function preferredProvider(kind: "image" | "video" | "audio" | "memory") {
  const prefs = await readPreferences();
  const value = prefs[`provider_${kind}`];
  return value && value !== "auto" ? value : undefined;
}

/** Enregistre (ou remplace) une préférence. */
export async function writePreference(key: PreferenceKey, value: string) {
  const res = await supabaseAdmin
    .from("app_preferences")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (res.error) throw new Error(res.error.message);
  return { key, value };
}
