import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";

/**
 * Compressed responses for the console's own files.
 *
 * The service used to stream every file as it is on disk. The main script is
 * 231 KB that way and about 70 KB gzipped; across the scripts and styles a
 * first visit carries roughly three times the bytes it needs to — on the
 * mobile data a lot of this country works on, that is seconds before the
 * dashboard appears.
 *
 * Built assets never change once deployed (their names carry a content hash),
 * so each is compressed once and kept in memory. Brotli where the browser
 * offers it, gzip otherwise. Images and fonts are already compressed and are
 * left alone.
 */

const COMPRESSIBLE = new Set([".js", ".css", ".html", ".json", ".svg", ".webmanifest", ".txt"]);
/* Below this, the headers cost more than compression saves. */
const MIN_BYTES = 1024;

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/** "br", "gzip", or null, from an Accept-Encoding header. q=0 means refused. */
export function pickEncoding(acceptEncoding) {
  const offered = new Map();
  for (const part of String(acceptEncoding || "").toLowerCase().split(",")) {
    const [name, ...params] = part.trim().split(";");
    if (!name) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    offered.set(name.trim(), q ? Number(q.slice(2)) : 1);
  }
  const ok = (name) => (offered.get(name) ?? (offered.has("*") ? offered.get("*") : 0)) > 0;
  if (ok("br")) return "br";
  if (ok("gzip")) return "gzip";
  return null;
}

export const isCompressible = (file) => COMPRESSIBLE.has(path.extname(file).toLowerCase());

const cache = new Map(); // `${encoding}:${file}` -> { mtimeMs, promise }

/**
 * The file's bytes in `encoding`, or null when compressing would not help.
 * Keyed on modification time too, so a rebuilt index.html is never served stale.
 */
export async function compressedBody(file, encoding) {
  const { mtimeMs, size } = await stat(file);
  if (size < MIN_BYTES) return null;
  const key = `${encoding}:${file}`;
  const hit = cache.get(key);
  if (hit && hit.mtimeMs === mtimeMs) return hit.promise;

  const promise = readFile(file).then((raw) =>
    encoding === "br"
      ? brotli(raw, {
          params: {
            /*
             * 9, not the maximum 11. Measured on this build: 11 is 8% smaller
             * but takes 11 s for the whole build and 3 s for the map bundle
             * alone — a visitor asking for it before the warm-up reached it
             * would wait that long. 9 does everything in under a second.
             */
            [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
          },
        })
      : gzip(raw, { level: 9 })
  );
  cache.set(key, { mtimeMs, promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

/** Compress everything up front, so the first visitor is not the one who waits. */
export async function warm(root, files) {
  for (const file of files) {
    if (!isCompressible(file)) continue;
    const full = path.join(root, file);
    // One at a time: this runs beside real traffic on a small container.
    // eslint-disable-next-line no-await-in-loop
    await compressedBody(full, "br").catch(() => {});
    // eslint-disable-next-line no-await-in-loop
    await compressedBody(full, "gzip").catch(() => {});
  }
}
