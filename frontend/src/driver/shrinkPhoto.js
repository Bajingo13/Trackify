/**
 * Makes a phone photo a sensible size before it is sent or saved for later.
 *
 * A current phone camera produces 4–12 MB per picture. The server takes 8 MB
 * for a receipt or delivery and 4 MB for a profile or licence photo, so an
 * untouched photo is often refused outright — and a refused photo saved while
 * out of signal is dropped when it replays. It also has to travel over the
 * weak connection a driver usually has, and sit in the phone's storage until
 * then.
 *
 * 2000 pixels on the long side keeps a receipt's small print legible; JPEG at
 * 0.85 keeps it clean. That comes to a few hundred kilobytes.
 *
 * Anything this cannot handle is passed through unchanged, never lost: a PDF,
 * a format the phone's browser cannot decode (HEIC on many Android builds), a
 * phone that runs out of memory decoding a huge image. The server then decides,
 * as it did before.
 */

export const MAX_EDGE = 2000;
export const QUALITY = 0.85;
/* Under this, a photo that is already small enough in pixels is left alone. */
export const SMALL_ENOUGH_BYTES = 1.5 * 1024 * 1024;

const PASS_THROUGH = new Set(["image/gif", "image/svg+xml"]);

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      // Honour the camera's rotation flag, or portrait shots arrive sideways.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Older engines reject the options object; fall through to the plain call.
      return await createImageBitmap(file);
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encodeJpeg(source, width, height, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  // A transparent PNG would otherwise turn black as a JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

const jpegName = (name) => `${(name || "photo").replace(/\.[^./\\]+$/, "") || "photo"}.jpg`;

export async function shrinkPhoto(file, { decode = decodeImage, encode = encodeJpeg } = {}) {
  if (!file || !String(file.type).startsWith("image/") || PASS_THROUGH.has(file.type)) return file;

  let source;
  try {
    source = await decode(file);
    const width = source.width;
    const height = source.height;
    if (!width || !height) return file;

    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    if (scale === 1 && file.size <= SMALL_ENOUGH_BYTES) return file;

    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const blob = await encode(source, w, h, QUALITY);
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    source?.close?.();
  }
}
