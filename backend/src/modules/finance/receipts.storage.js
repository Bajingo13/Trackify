/**
 * Driver-captured file storage — expense receipts and proof-of-delivery photos.
 *
 * Files live on disk under backend/uploads/receipts/<year>/<month>/ and the
 * database only stores the relative path. Keeping the bytes out of MySQL
 * keeps the table small and lets the OS do what it is good at; keeping the
 * path relative means the upload directory can move between environments.
 *
 * Nothing here is ever served as a static directory — receipts are financial
 * records, so every read goes through an authenticated, company-scoped route.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configuredUploadRoot =
  process.env.UPLOAD_ROOT || process.env.RAILWAY_VOLUME_MOUNT_PATH;

export const UPLOAD_ROOT = configuredUploadRoot
  ? path.resolve(configuredUploadRoot)
  : path.resolve(__dirname, "..", "..", "..", "uploads");
export const STORAGE_IS_PERSISTENT = Boolean(configuredUploadRoot);
const RECEIPT_ROOT = path.join(UPLOAD_ROOT, "receipts");
const POD_ROOT = path.join(UPLOAD_ROOT, "pod");

/** Phone cameras produce a few MB; anything larger is not a receipt photo. */
export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

const ALLOWED = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/heic", ".heic"],
  ["application/pdf", ".pdf"],
]);

function monthDir(root) {
  const now = new Date();
  const dir = path.join(
    root,
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0")
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const diskStore = (root) => multer.diskStorage({
  destination: (_req, _file, cb) => {
    try { cb(null, monthDir(root)); } catch (e) { cb(e); }
  },
  filename: (_req, file, cb) => {
    // random name: the original is kept in the DB, and user-supplied names
    // must never reach the filesystem
    const ext = ALLOWED.get(file.mimetype) || "";
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const uploader = (root) => multer({
  storage: diskStore(root),
  limits: { fileSize: MAX_RECEIPT_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      const err = new Error("The photo must be a JPG, PNG, WebP, HEIC or PDF.");
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

export const receiptUpload = uploader(RECEIPT_ROOT);
export const podUpload = uploader(POD_ROOT);

/**
 * Confirm that evidence storage is usable before accepting traffic. Railway
 * volumes expose RAILWAY_VOLUME_MOUNT_PATH automatically, while UPLOAD_ROOT
 * remains available for other hosts and local testing.
 */
export async function verifyUploadStorage() {
  const probe = path.join(
    UPLOAD_ROOT,
    `.trackify-write-check-${process.pid}-${crypto.randomUUID()}`
  );
  try {
    await fs.promises.mkdir(RECEIPT_ROOT, { recursive: true });
    await fs.promises.mkdir(POD_ROOT, { recursive: true });
    await fs.promises.writeFile(probe, "ok", { flag: "wx" });
    await fs.promises.unlink(probe);
    return {
      ok: true,
      persistent: STORAGE_IS_PERSISTENT,
      mode: STORAGE_IS_PERSISTENT ? "persistent" : "local",
    };
  } catch (error) {
    await fs.promises.unlink(probe).catch(() => {});
    return {
      ok: false,
      persistent: STORAGE_IS_PERSISTENT,
      mode: "unavailable",
      error: error.code || error.message,
    };
  }
}

/** Path stored in the DB — relative to UPLOAD_ROOT so the root can move. */
export const toRelative = (absolutePath) =>
  path.relative(UPLOAD_ROOT, absolutePath).split(path.sep).join("/");

/** Resolves a stored path back, refusing anything that escapes the root. */
export function toAbsolute(relativePath) {
  const abs = path.resolve(UPLOAD_ROOT, relativePath);
  if (abs !== UPLOAD_ROOT && !abs.startsWith(UPLOAD_ROOT + path.sep)) {
    throw Object.assign(new Error("Invalid attachment path."), { status: 400 });
  }
  return abs;
}

/** Best-effort cleanup when the row it belongs to could not be written. */
export function discard(absolutePath) {
  if (!absolutePath) return;
  fs.promises.unlink(absolutePath).catch(() => {});
}
