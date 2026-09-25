import { describe, expect, it, vi } from "vitest";
import { MAX_EDGE, SMALL_ENOUGH_BYTES, shrinkPhoto } from "./shrinkPhoto.js";

/*
 * Decoding and encoding are the browser's; these tests fake both and check the
 * decisions — what gets shrunk, to what, and that nothing is ever lost.
 */
const photo = (bytes, type = "image/jpeg", name = "IMG_2041.JPG") =>
  new File([new Uint8Array(bytes)], name, { type });

const decodesTo = (width, height) => vi.fn(async () => ({ width, height, close: vi.fn() }));
const encodesTo = (bytes) => vi.fn(async () => new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));

describe("shrinking a photo before upload", () => {
  it("brings a large camera photo down to the long-edge limit as a JPEG", async () => {
    const encode = encodesTo(400_000);
    const out = await shrinkPhoto(photo(6_000_000), { decode: decodesTo(4000, 3000), encode });

    expect(encode).toHaveBeenCalledWith(expect.anything(), MAX_EDGE, 1500, expect.any(Number));
    expect(out.type).toBe("image/jpeg");
    expect(out.size).toBe(400_000);
    expect(out.name).toBe("IMG_2041.jpg");
  });

  it("keeps a portrait photo portrait", async () => {
    const encode = encodesTo(300_000);
    await shrinkPhoto(photo(5_000_000), { decode: decodesTo(3000, 4000), encode });
    expect(encode).toHaveBeenCalledWith(expect.anything(), 1500, MAX_EDGE, expect.any(Number));
  });

  it("re-compresses a heavy photo even when its pixels are already small enough", async () => {
    const encode = encodesTo(500_000);
    const out = await shrinkPhoto(photo(SMALL_ENOUGH_BYTES + 1), { decode: decodesTo(1800, 1200), encode });
    expect(encode).toHaveBeenCalledWith(expect.anything(), 1800, 1200, expect.any(Number));
    expect(out.size).toBe(500_000);
  });

  it("leaves a photo that is already small alone", async () => {
    const original = photo(300_000);
    const encode = encodesTo(1);
    expect(await shrinkPhoto(original, { decode: decodesTo(1200, 900), encode })).toBe(original);
    expect(encode).not.toHaveBeenCalled();
  });

  it("passes a PDF receipt through untouched", async () => {
    const pdf = photo(2_000_000, "application/pdf", "receipt.pdf");
    const decode = decodesTo(1, 1);
    expect(await shrinkPhoto(pdf, { decode })).toBe(pdf);
    expect(decode).not.toHaveBeenCalled();
  });

  it("sends the original when the phone cannot decode it (HEIC, say)", async () => {
    const heic = photo(3_000_000, "image/heic", "IMG_1.HEIC");
    const decode = vi.fn(async () => { throw new Error("unsupported"); });
    expect(await shrinkPhoto(heic, { decode })).toBe(heic);
  });

  it("sends the original when encoding fails or would not make it smaller", async () => {
    const original = photo(6_000_000);
    expect(await shrinkPhoto(original, { decode: decodesTo(4000, 3000), encode: vi.fn(async () => null) })).toBe(original);
    expect(await shrinkPhoto(original, { decode: decodesTo(4000, 3000), encode: encodesTo(7_000_000) })).toBe(original);
  });

  it("frees the decoded image", async () => {
    const bitmap = { width: 4000, height: 3000, close: vi.fn() };
    await shrinkPhoto(photo(6_000_000), { decode: async () => bitmap, encode: encodesTo(10) });
    expect(bitmap.close).toHaveBeenCalled();
  });
});
