import { createUploadTicket, finalizeUpload } from "./attachments.functions";

export const MAX_FILE_SIZE = 120 * 1024 * 1024;

export type PendingAttachment = {
  localId: string;
  name: string;
  size: number;
  mimeType: string;
  progress: number;
  status: "uploading" | "ready" | "error";
  attachmentId?: string;
  error?: string;
  previewUrl?: string;
};

/** Envoi direct au stockage avec progression réelle (XHR sur URL signée). */
export async function uploadAttachment(
  file: File,
  conversationId: string | null,
  onProgress: (percent: number) => void,
): Promise<string> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `« ${file.name} » fait ${(file.size / 1048576).toFixed(1)} Mo : la limite est de 120 Mo.`,
    );
  }

  const ticket = await createUploadTicket({
    data: {
      name: file.name,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      conversationId,
    },
  });

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", ticket.uploadUrl, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Envoi refusé par le stockage (HTTP ${xhr.status}).`));
    xhr.onerror = () => reject(new Error("Connexion interrompue pendant l'envoi."));
    xhr.send(file);
  });

  const done = await finalizeUpload({ data: { attachmentId: ticket.attachmentId } });
  onProgress(100);
  return done.id;
}
