import { unzipSync, strFromU8 } from "fflate";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const MAX_FILE_SIZE = 120 * 1024 * 1024; // 120 MB
export const ATTACHMENT_BUCKET = "attachments";
const SIGNED_TTL = 60 * 60 * 6;

export type AttachmentRow = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  message_id: string | null;
  name: string;
  size: number;
  mime_type: string;
  storage_path: string;
  status: string;
  extracted_text: string | null;
};

export function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "fichier";
}

export async function signedAttachmentUrl(path: string) {
  const signed = await supabaseAdmin.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(path, SIGNED_TTL);
  if (signed.error || !signed.data) {
    throw new Error(`Lien de fichier indisponible : ${signed.error?.message ?? "inconnu"}`);
  }
  return signed.data.signedUrl;
}

export async function downloadAttachment(path: string): Promise<Uint8Array> {
  const file = await supabaseAdmin.storage.from(ATTACHMENT_BUCKET).download(path);
  if (file.error || !file.data) {
    throw new Error(`Fichier introuvable dans le stockage : ${file.error?.message ?? path}`);
  }
  return new Uint8Array(await file.data.arrayBuffer());
}

/** Récupère les pièces jointes d'un utilisateur, en vérifiant la propriété. */
export async function loadOwnedAttachments(ids: string[], userId: string) {
  if (ids.length === 0) return [];
  const rows = await supabaseAdmin
    .from("attachments")
    .select("*")
    .in("id", ids)
    .eq("user_id", userId);
  if (rows.error) throw new Error(rows.error.message);
  return (rows.data ?? []) as unknown as AttachmentRow[];
}

const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|xml|yaml|yml|html?|css|js|jsx|ts|tsx|py|rb|go|rs|java|kt|c|h|cpp|cs|php|sh|sql|ini|toml|env|log|srt|vtt)$/i;

export function isTextLike(mime: string, name: string) {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    mime === "application/x-yaml" ||
    TEXT_EXT.test(name)
  );
}

function xmlToText(xml: string) {
  return xml
    .replace(/<\/w:p>|<\/a:p>|<\/text:p>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function entriesOf(bytes: Uint8Array) {
  return unzipSync(bytes);
}

function extractDocx(bytes: Uint8Array) {
  const files = entriesOf(bytes);
  const doc = files["word/document.xml"];
  if (!doc) throw new Error("Document Word illisible (word/document.xml absent).");
  return xmlToText(strFromU8(doc));
}

function extractPptx(bytes: Uint8Array) {
  const files = entriesOf(bytes);
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (slides.length === 0) throw new Error("Présentation illisible (aucune diapositive trouvée).");
  return slides
    .map((n, i) => `## Diapositive ${i + 1}\n${xmlToText(strFromU8(files[n]!))}`)
    .join("\n\n");
}

function extractXlsx(bytes: Uint8Array) {
  const files = entriesOf(bytes);
  const sharedRaw = files["xl/sharedStrings.xml"];
  const shared: string[] = [];
  if (sharedRaw) {
    const xml = strFromU8(sharedRaw);
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlToText(m[1]!));
  }
  const sheets = Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort();
  if (sheets.length === 0) throw new Error("Classeur illisible (aucune feuille trouvée).");
  const out: string[] = [];
  for (const [index, name] of sheets.entries()) {
    const xml = strFromU8(files[name]!);
    const lines: string[] = [];
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cell of row[1]!.matchAll(/<c[^>]*?(t="[^"]*")?[^>]*>([\s\S]*?)<\/c>/g)) {
        const type = cell[1] ?? "";
        const value = (cell[2]!.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "").trim();
        if (!value) {
          cells.push("");
        } else if (type.includes('"s"')) {
          cells.push(shared[Number(value)] ?? "");
        } else {
          cells.push(value);
        }
      }
      if (cells.some((c) => c !== "")) lines.push(cells.join(" | "));
    }
    out.push(`## Feuille ${index + 1}\n${lines.slice(0, 500).join("\n")}`);
  }
  return out.join("\n\n");
}

function extractZip(bytes: Uint8Array) {
  const files = entriesOf(bytes);
  const names = Object.keys(files);
  const listing = names.map((n) => `- ${n} (${files[n]!.length} octets)`).join("\n");
  const previews: string[] = [];
  for (const name of names) {
    if (previews.length >= 15) break;
    if (!TEXT_EXT.test(name)) continue;
    const content = strFromU8(files[name]!).slice(0, 4000);
    previews.push(`### ${name}\n${content}`);
  }
  return `Contenu de l'archive (${names.length} entrées) :\n${listing}\n\n${previews.join("\n\n")}`;
}

export type ExtractedAttachment =
  | { kind: "text"; text: string }
  | { kind: "image"; mediaType: string; url: string }
  | { kind: "pdf"; mediaType: string; base64: string }
  | { kind: "audio"; mediaType: string; base64: string; format: string }
  | { kind: "video"; mediaType: string; url: string }
  | { kind: "unsupported"; reason: string };

const AUDIO_FORMATS: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

const INLINE_LIMIT = 24 * 1024 * 1024;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Transforme une pièce jointe stockée en entrée réellement exploitable par le modèle.
 * Aucun contenu n'est inventé : un format non extractible est signalé comme tel.
 */
export async function extractAttachment(row: AttachmentRow): Promise<ExtractedAttachment> {
  const mime = row.mime_type || "application/octet-stream";
  const name = row.name;

  if (mime.startsWith("image/")) {
    return { kind: "image", mediaType: mime, url: await signedAttachmentUrl(row.storage_path) };
  }
  if (mime.startsWith("video/")) {
    return { kind: "video", mediaType: mime, url: await signedAttachmentUrl(row.storage_path) };
  }
  if (mime.startsWith("audio/")) {
    if (row.size > INLINE_LIMIT) {
      return {
        kind: "unsupported",
        reason: `Fichier audio de ${(row.size / 1048576).toFixed(1)} Mo : au-delà de 24 Mo l'audio ne peut pas être transmis au modèle. Fournis un extrait plus court.`,
      };
    }
    const bytes = await downloadAttachment(row.storage_path);
    return {
      kind: "audio",
      mediaType: mime,
      base64: toBase64(bytes),
      format: AUDIO_FORMATS[mime] ?? "mp3",
    };
  }
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) {
    if (row.size > INLINE_LIMIT) {
      return {
        kind: "unsupported",
        reason: `PDF de ${(row.size / 1048576).toFixed(1)} Mo : au-delà de 24 Mo il ne peut pas être transmis au modèle.`,
      };
    }
    const bytes = await downloadAttachment(row.storage_path);
    return { kind: "pdf", mediaType: "application/pdf", base64: toBase64(bytes) };
  }

  if (isTextLike(mime, name)) {
    const bytes = await downloadAttachment(row.storage_path);
    const text = new TextDecoder().decode(bytes.subarray(0, 400_000));
    return { kind: "text", text };
  }

  try {
    const lower = name.toLowerCase();
    if (lower.endsWith(".docx")) {
      const bytes = await downloadAttachment(row.storage_path);
      return { kind: "text", text: extractDocx(bytes) };
    }
    if (lower.endsWith(".pptx")) {
      const bytes = await downloadAttachment(row.storage_path);
      return { kind: "text", text: extractPptx(bytes) };
    }
    if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
      const bytes = await downloadAttachment(row.storage_path);
      return { kind: "text", text: extractXlsx(bytes) };
    }
    if (lower.endsWith(".zip")) {
      const bytes = await downloadAttachment(row.storage_path);
      return { kind: "text", text: extractZip(bytes) };
    }
  } catch (error) {
    return {
      kind: "unsupported",
      reason: `Extraction impossible : ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    kind: "unsupported",
    reason: `Le fichier est bien stocké, mais son format (${mime || "inconnu"}) ne peut pas être extrait automatiquement. Une conversion est nécessaire (ex : .doc → .docx, .xls → .xlsx).`,
  };
}
