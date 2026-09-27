// @vitest-environment node
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { compressedBody, isCompressible, pickEncoding } from "./compression.js";

describe("choosing an encoding", () => {
  it("prefers brotli, then gzip, then nothing", () => {
    expect(pickEncoding("gzip, deflate, br, zstd")).toBe("br");
    expect(pickEncoding("gzip, deflate")).toBe("gzip");
    expect(pickEncoding("identity")).toBe(null);
    expect(pickEncoding(undefined)).toBe(null);
  });

  it("honours a refusal (q=0) and a wildcard", () => {
    expect(pickEncoding("br;q=0, gzip")).toBe("gzip");
    expect(pickEncoding("br;q=0, gzip;q=0")).toBe(null);
    expect(pickEncoding("*")).toBe("br");
    expect(pickEncoding("*, br;q=0")).toBe("gzip");
  });

  it("compresses text, never images or fonts", () => {
    expect(isCompressible("assets/index-abc.js")).toBe(true);
    expect(isCompressible("assets/app.CSS")).toBe(true);
    expect(isCompressible("favicon.svg")).toBe(true);
    expect(isCompressible("hero-truck.jpg")).toBe(false);
    expect(isCompressible("fonts/geist.woff2")).toBe(false);
  });
});

describe("compressed bodies", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tk-compress-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("round-trips exactly, in both encodings, and is much smaller", async () => {
    const file = path.join(dir, "bundle.js");
    const source = "export const truck = { plate: 'ABC 1234', route: 'Davao -> Calamba' };\n".repeat(400);
    writeFileSync(file, source);

    const br = await compressedBody(file, "br");
    const gz = await compressedBody(file, "gzip");
    expect(zlib.brotliDecompressSync(br).toString()).toBe(source);
    expect(zlib.gunzipSync(gz).toString()).toBe(source);
    expect(br.length).toBeLessThan(source.length / 4);
  });

  it("leaves a tiny file alone", async () => {
    const file = path.join(dir, "tiny.css");
    writeFileSync(file, "a{}");
    expect(await compressedBody(file, "gzip")).toBe(null);
  });

  it("never serves a stale copy of a rebuilt file", async () => {
    const file = path.join(dir, "index.html");
    writeFileSync(file, "<p>old</p>".repeat(300));
    const first = await compressedBody(file, "gzip");
    writeFileSync(file, "<p>new</p>".repeat(300));
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    const second = await compressedBody(file, "gzip");
    expect(zlib.gunzipSync(first).toString()).toContain("old");
    expect(zlib.gunzipSync(second).toString()).toContain("new");
  });
});
