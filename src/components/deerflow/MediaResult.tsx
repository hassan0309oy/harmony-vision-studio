import { AlertTriangle, Download, ExternalLink } from "lucide-react";

export type ToolResult = Record<string, unknown> | null | undefined;

export function isFailure(result: ToolResult): result is { ok: false; capability: string; error: string } {
  return Boolean(result && (result as { ok?: unknown }).ok === false);
}

export function ToolError({ result }: { result: { capability: string; error: string } }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
      <div>
        <p className="font-medium">Échec : {result.capability}</p>
        <p className="mt-0.5 text-muted-foreground">{result.error}</p>
      </div>
    </div>
  );
}

/** Aperçu + téléchargement d'un média réellement produit et stocké. */
export function MediaResult({ result }: { result: Record<string, unknown> }) {
  const url = typeof result["url"] === "string" ? (result["url"] as string) : null;
  const kind = typeof result["kind"] === "string" ? (result["kind"] as string) : "";
  const provider = typeof result["provider"] === "string" ? (result["provider"] as string) : "";
  const fileName = typeof result["fileName"] === "string" ? (result["fileName"] as string) : "fichier";
  if (!url) return null;

  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card">
      {kind === "image" && (
        <img src={url} alt={String(result["prompt"] ?? "Image générée")} className="w-full" loading="lazy" />
      )}
      {kind === "video" && <video src={url} controls className="w-full" />}
      {kind === "audio" && <audio src={url} controls className="w-full p-3" />}
      {kind !== "image" && kind !== "video" && kind !== "audio" && (
        <div className="p-4 text-sm">{fileName}</div>
      )}
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span className="truncate">
          {kind || "fichier"}
          {provider ? ` · ${provider}` : ""}
        </span>
        <span className="flex items-center gap-3">
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
            <ExternalLink className="size-3" /> Ouvrir
          </a>
          <a href={url} download={fileName} className="inline-flex items-center gap-1 text-primary hover:underline">
            <Download className="size-3" /> Télécharger
          </a>
        </span>
      </figcaption>
    </figure>
  );
}

export function CodeOutput({ result }: { result: Record<string, unknown> }) {
  const stdout = typeof result["stdout"] === "string" ? result["stdout"] : "";
  const stderr = typeof result["stderr"] === "string" ? result["stderr"] : "";
  const images = Array.isArray(result["images"]) ? (result["images"] as string[]) : [];
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3">
      {stdout && <pre className="overflow-auto text-xs whitespace-pre-wrap">{stdout}</pre>}
      {stderr && <pre className="overflow-auto text-xs whitespace-pre-wrap text-destructive">{stderr}</pre>}
      {images.map((src, i) => (
        <img key={i} src={src.startsWith("data:") ? src : `data:image/png;base64,${src}`} alt="Graphique" className="w-full rounded-lg" />
      ))}
    </div>
  );
}
