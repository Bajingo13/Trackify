import { shrinkPhoto } from "../../driver/shrinkPhoto";

/**
 * Whatever the office was given — a phone photo or a PDF from the scanner —
 * as an image the server can read and keep.
 *
 * Scanners very often write PDFs, and the server reads images only. So a PDF's
 * first page (the front of the licence) is drawn to a canvas here and sent as a
 * JPEG; the picture that is read is then exactly the picture that is stored. A
 * PDF that cannot be opened says so, and the person can export it as an image.
 *
 * The PDF library is loaded only when a PDF is actually chosen: it is large, and
 * most licences arrive as photographs.
 */

/** The width the first page is drawn at: enough for the small print on a card scan to survive. */
export const PDF_RENDER_WIDTH = 2000;

async function renderFirstPage(file) {
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    const page = await pdf.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PDF_RENDER_WIDTH / natural.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    // a scan with a transparent background would otherwise become black text on black
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  } finally {
    pdf.destroy?.();
  }
}

const jpegName = (name) => `${String(name || "licence").replace(/\.[^./\\]+$/, "") || "licence"}.jpg`;

export const isPdf = (file) => file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");

/**
 * @returns {Promise<File>} an image file; rejects with a message fit to show when a PDF cannot be opened
 */
export async function prepareLicenceFile(file, { render = renderFirstPage, shrink = shrinkPhoto } = {}) {
  if (!isPdf(file)) return shrink(file);

  let blob;
  try {
    blob = await render(file);
  } catch {
    blob = null;
  }
  if (!blob) {
    throw new Error("That PDF could not be opened. Save the licence as a JPG or PNG image and upload that instead.");
  }
  return shrink(new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified }));
}
