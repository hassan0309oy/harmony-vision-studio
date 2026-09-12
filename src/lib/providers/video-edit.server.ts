import { Sandbox } from "@e2b/code-interpreter";

import { downloadAttachment, loadOwnedAttachments } from "./attachments.server";
import { requireEnv } from "./errors.server";
import { storeAsset, type StoredAsset } from "./storage.server";

type SubtitleFile = {
  format: "ass" | "srt";
  content: string;
};

type EditVideoParams = {
  attachmentId: string;
  userId: string;
  ffmpegArgs: string[];
  subtitleFile?: SubtitleFile | undefined;
  fileName?: string | undefined;
  description?: string | undefined;
};

const MAX_ARGUMENTS = 160;
const MAX_ARGUMENT_LENGTH = 12_000;
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Monte réellement une vidéo jointe avec FFmpeg dans un environnement isolé,
 * puis rapatrie et stocke le MP4 produit avant de fermer le sandbox.
 */
export async function editAttachedVideo(params: EditVideoParams): Promise<StoredAsset> {
  const apiKey = requireEnv("E2B_API_KEY", "le montage vidéo");
  if (params.ffmpegArgs.length === 0 || params.ffmpegArgs.length > MAX_ARGUMENTS) {
    throw new Error(`Le montage doit contenir entre 1 et ${MAX_ARGUMENTS} arguments FFmpeg.`);
  }
  if (params.ffmpegArgs.some((argument) => argument.length > MAX_ARGUMENT_LENGTH)) {
    throw new Error("Un argument FFmpeg est trop long.");
  }
  if (params.subtitleFile && new TextEncoder().encode(params.subtitleFile.content).byteLength > MAX_SUBTITLE_BYTES) {
    throw new Error("Le fichier de sous-titres dépasse 2 Mo.");
  }

  const rows = await loadOwnedAttachments([params.attachmentId], params.userId);
  const attachment = rows[0];
  if (!attachment) throw new Error("Vidéo jointe introuvable ou inaccessible pour ce compte.");
  if (!attachment.mime_type.startsWith("video/")) {
    throw new Error(`La pièce jointe « ${attachment.name} » n'est pas une vidéo.`);
  }

  const inputBytes = await downloadAttachment(attachment.storage_path);
  const inputPath = "/tmp/input.mp4";
  const outputPath = "/tmp/output.mp4";
  const subtitlePath = params.subtitleFile ? `/tmp/subtitles.${params.subtitleFile.format}` : null;
  const sandbox = await Sandbox.create({ apiKey, timeoutMs: 10 * 60 * 1000 });

  try {
    await sandbox.files.write(inputPath, inputBytes.slice().buffer);
    if (subtitlePath && params.subtitleFile) {
      await sandbox.files.write(subtitlePath, params.subtitleFile.content);
    }

    const install = await sandbox.commands.run(
      "command -v ffmpeg >/dev/null 2>&1 || (sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg fonts-dejavu-core fonts-liberation >/dev/null)",
      { timeoutMs: 180_000 },
    );
    if (install.exitCode !== 0) {
      throw new Error(`Installation du moteur vidéo impossible : ${install.stderr || install.error || "erreur inconnue"}`);
    }

    const args = params.ffmpegArgs.map(shellQuote).join(" ");
    const command = `ffmpeg -hide_banner -y -i ${shellQuote(inputPath)} ${args} ${shellQuote(outputPath)}`;
    const render = await sandbox.commands.run(command, { timeoutMs: 8 * 60 * 1000 });
    if (render.exitCode !== 0) {
      throw new Error(`Le rendu FFmpeg a échoué : ${(render.stderr || render.error || "erreur inconnue").slice(-3000)}`);
    }

    const outputBytes = await sandbox.files.read(outputPath, { format: "bytes" });
    if (outputBytes.byteLength === 0) throw new Error("Le moteur de montage a produit un fichier vide.");

    return storeAsset({
      kind: "video",
      data: outputBytes,
      mimeType: "video/mp4",
      provider: "e2b-ffmpeg",
      ...(params.description ? { prompt: params.description } : {}),
      fileName: params.fileName ?? `montage-${Date.now()}.mp4`,
      metadata: {
        sourceAttachmentId: params.attachmentId,
        sourceName: attachment.name,
        ffmpegArgs: params.ffmpegArgs,
        hasSubtitles: Boolean(params.subtitleFile),
      },
    });
  } finally {
    await sandbox.kill().catch(() => undefined);
  }
}