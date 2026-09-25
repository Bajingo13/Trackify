/**
 * Driver-captured file storage — expense receipts, proof-of-delivery photos,
 * and the driver's own profile photograph.
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
const AVATAR_ROOT = path.join(UPLOAD_ROOT, "avatars");
const VEHICLE_TYPE_ROOT = path.join(UPLOAD_ROOT, "vehicle-types");
/* A photograph of a driver's licence — personal data, kept apart from the
 * paperwork of the business so retention can be reasoned about separately. */
const LICENSE_ROOT = path.join(UPLOAD_ROOT, "licenses");
/* Registration, insurance and the rest: company paperwork, often a PDF. */
const DOCUMENT_ROOT = path.join(UPLOAD_ROOT, "documents");

/** Phone cameras produce a few MB; anything larger is not a receipt photo. */
export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

/**
 * A profile photograph is shown at about 96px. A phone camera will hand over
 * six megabytes for that, and every byte travels over cell data the driver may
 * be paying for themselves, so it is capped well below a receipt.
 */
export const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

const ALLOWED = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/heic", ".heic"],
  ["application/pdf", ".pdf"],
]);

/* A receipt may legitimately be a PDF the fuel station emailed. A face cannot. */
const IMAGES_ONLY = new Map([...ALLOWED].filter(([mime]) => mime.startsWith("image/")));

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

const diskStore = (root, allowed) => multer.diskStorage({
  destination: (_req, _file, cb) => {
    try { cb(null, monthDir(root)); } catch (e) { cb(e); }
  },
  filename: (_req, file, cb) => {
    // random name: the original is kept in the DB, and user-supplied names
    // must never reach the filesystem
    const ext = allowed.get(file.mimetype) || "";
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const uploader = (root, { allowed = ALLOWED, maxBytes = MAX_RECEIPT_BYTES, rejection } = {}) => {
  const upload = multer({
    storage: diskStore(root, allowed),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!allowed.has(file.mimetype)) {
        const err = new Error(rejection || "The photo must be a JPG, PNG, WebP, HEIC or PDF.");
        err.status = 400;
        return cb(err);
      }
      cb(null, true);
    },
  });

  /*
   * multer reports an oversized file as a MulterError carrying neither a
   * status nor the limit it hit, so the error handler could only answer 500
   * "Internal server error." The limit is attached here, where it is known,
   * so the answer can be 413 and say how large a file may be.
   *
   * This is not cosmetic for the Driver App. Its offline queue drops a 4xx and
   * retries anything else in order — so a 500 for a photo that can never fit
   * sat at the head of the queue for ever, and nothing the driver did after it
   * was ever sent.
   */
  const single = upload.single.bind(upload);
  upload.single = (field) => {
    const middleware = single(field);
    return (req, res, next) =>
      middleware(req, res, async (err) => {
        if (err) {
          if (err.code === "LIMIT_FILE_SIZE") err.maxBytes = maxBytes;
          return next(err);
        }
        if (!req.file) return next();

        /*
         * The type the browser declared is only a claim. An HTML page sent as
         * image/png passed every check above and was stored as a photograph.
         * nosniff stops a browser rendering it as HTML when it is served back,
         * but the evidence store should not hold it at all.
         *
         * So the first bytes are read, and the file must actually BE one of
         * the types this upload accepts. It does not have to be the type it
         * was declared as: a PNG saved with a .jpg name is a real photograph,
         * and refusing it would turn away a genuine receipt over a filename.
         * Its recorded type is corrected to what the bytes say instead, so it
         * is served with the right one.
         */
        try {
          const detected = await detectStoredType(req.file.path);
          if (!detected || !allowed.has(detected)) {
            discard(req.file.path);
            const refused = new Error(rejection || "The photo must be a JPG, PNG, WebP, HEIC or PDF.");
            refused.status = 400;
            return next(refused);
          }
          req.file.mimetype = detected;
          return next();
        } catch (readError) {
          discard(req.file.path);
          return next(readError);
        }
      });
  };
  return upload;
};

/* ------------------------------------------------------------------ */
/* What a stored file actually is                                     */
/* ------------------------------------------------------------------ */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/*
 * HEIC and HEIF are ISO media files: "ftyp" at byte 4, then a brand. Phones
 * disagree about which brand they write — iPhones usually "heic", many
 * Android cameras "mif1" — so every brand a still image can carry is
 * accepted, and video brands are not.
 */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

/** The real type of a file from its first bytes, or null if it is none we take. */
export function detectFileType(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp" && HEIF_BRANDS.has(b.toString("latin1", 8, 12))) {
    return "image/heic";
  }
  // PDF readers accept the header anywhere in the first kilobyte, and some
  // generators do put a few bytes in front of it, so this looks there too.
  if (b.subarray(0, 1024).toString("latin1").includes("%PDF-")) return "application/pdf";
  return null;
}

async function detectStoredType(filePath) {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return detectFileType(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export const receiptUpload = uploader(RECEIPT_ROOT);
export const podUpload = uploader(POD_ROOT);
export const avatarUpload = uploader(AVATAR_ROOT, {
  allowed: IMAGES_ONLY,
  maxBytes: MAX_AVATAR_BYTES,
  rejection: "Your photo must be a JPG, PNG, WebP or HEIC image.",
});

/**
 * A company's photograph for a kind of vehicle.
 *
 * Shown on a dark surface as often as a light one, so a PNG with a transparent
 * background is what this actually wants. That cannot be enforced from the
 * mimetype — a PNG with a white rectangle baked in is still a valid PNG — so
 * the format is accepted and the guidance lives next to the upload control
 * where somebody choosing a file can read it.
 */
export const vehicleTypeUpload = uploader(VEHICLE_TYPE_ROOT, {
  allowed: IMAGES_ONLY,
  maxBytes: MAX_AVATAR_BYTES,
  rejection: "The photo must be a PNG, JPG or WebP image. PNG with a transparent background looks best.",
});

/**
 * A driver's licence.
 *
 * Kept at the full receipt size rather than the avatar's: a licence is read,
 * not glanced at — an expiry date and a restriction code have to survive being
 * photographed at arm's length in a truck cab. A PDF is allowed because an
 * office scanning licences at onboarding will produce them.
 */
export const licenseUpload = uploader(LICENSE_ROOT, {
  rejection: "The licence must be a JPG, PNG, WebP, HEIC or PDF.",
});

/**
 * Registration, insurance, and any other compliance document.
 *
 * Most arrive as a PDF from the issuer, some as a photograph of the paper.
 */
export const documentUpload = uploader(DOCUMENT_ROOT, {
  rejection: "The document must be a JPG, PNG, WebP, HEIC or PDF.",
});

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
    await fs.promises.mkdir(AVATAR_ROOT, { recursive: true });
    await fs.promises.mkdir(VEHICLE_TYPE_ROOT, { recursive: true });
    await fs.promises.mkdir(LICENSE_ROOT, { recursive: true });
    await fs.promises.mkdir(DOCUMENT_ROOT, { recursive: true });
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
