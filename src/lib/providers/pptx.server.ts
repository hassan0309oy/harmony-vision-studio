import { storeAsset, type StoredAsset } from "./storage.server";

export type Slide = {
  title: string;
  bullets?: string[];
  notes?: string;
};

/** Génère un vrai fichier .pptx avec PptxGenJS et le stocke. */
export async function buildPresentation(params: {
  title: string;
  subtitle?: string;
  slides: Slide[];
}): Promise<StoredAsset & { slides: number }> {
  if (params.slides.length === 0) throw new Error("La présentation doit contenir au moins une diapositive.");
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = params.title;

  const cover = pptx.addSlide();
  cover.background = { color: "0F172A" };
  cover.addText(params.title, {
    x: 0.6,
    y: 2.0,
    w: 8.8,
    h: 1.2,
    fontSize: 36,
    bold: true,
    color: "FFFFFF",
  });
  if (params.subtitle) {
    cover.addText(params.subtitle, { x: 0.6, y: 3.2, w: 8.8, h: 0.8, fontSize: 18, color: "5EEAD4" });
  }

  for (const s of params.slides) {
    const slide = pptx.addSlide();
    slide.addText(s.title, { x: 0.6, y: 0.5, w: 8.8, h: 0.8, fontSize: 26, bold: true, color: "0F172A" });
    if (s.bullets?.length) {
      slide.addText(
        s.bullets.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
        { x: 0.8, y: 1.5, w: 8.4, h: 4.2, fontSize: 16, color: "334155" },
      );
    }
    if (s.notes) slide.addNotes(s.notes);
  }

  const out = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  const asset = await storeAsset({
    kind: "presentation",
    data: new Uint8Array(out),
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    provider: "pptxgenjs",
    prompt: params.title,
    fileName: `${params.title.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40) || "presentation"}.pptx`,
    metadata: { slides: params.slides.length },
  });
  return { ...asset, slides: params.slides.length };
}
