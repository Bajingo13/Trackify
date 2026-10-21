/**
 * Reading a photographed driver's licence.
 *
 * The engine is Tesseract, run inside this server. That is a choice, not a
 * default: a licence is a photograph of an identity document, and the privacy
 * policy tells drivers where their data goes. Sending it to a third-party
 * recognition service would add a processor to that answer; doing it here adds
 * none, needs no account or key, and keeps working when the network is bad.
 * The cost is accuracy on a poor photo, which is why a scan only ever PROPOSES
 * values — the screens show them next to the card and a person confirms.
 *
 * What this module is careful about:
 *
 *   • A scan is not a save. The uploaded file is deleted as soon as it has been
 *     read, whatever happens; the picture is kept only when the person then
 *     saves the licence through the ordinary upload.
 *   • One scan at a time. OCR is CPU-heavy and a few simultaneous scans would
 *     starve the trips and tracking this server exists for. Callers beyond a
 *     short queue are told to try again, rather than piling up.
 *   • A scan that hangs is killed and the engine rebuilt. A bad file must not
 *     wedge scanning for everyone until the next restart.
 *   • The engine is loaded on first use and released after a quiet spell. It
 *     holds around a hundred megabytes, and most days nobody scans anything.
 *   • The native image library is imported lazily. If it cannot load on some
 *     host, scanning reports itself unavailable without stopping the API from
 *     starting; registration and replacement remain safely blocked.
 *   • Each person gets a small allowance, so a stuck client or a stolen token
 *     cannot use scanning to burn the server's CPU.
 *
 * LICENSE_SCAN=off turns it off without a deploy of code.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { discard } from "../../modules/finance/receipts.storage.js";
import { parseLicenseText } from "./parseLicense.js";
import { daysUntilExpiry } from "../driverLicense.js";

const require = createRequire(import.meta.url);

export const SCAN_TIMEOUT_MS = Number(process.env.LICENSE_SCAN_TIMEOUT_MS) || 45_000;
export const MAX_WAITING = 4;
export const IDLE_RELEASE_MS = 5 * 60_000;
// Registering a driver spends two scans (the form reads the photo, the server reads it
// again to check the details) and every retry after a mismatch spends two more, so
// this has to be roomy enough for an office working through a batch of new drivers.
export const ALLOWANCE = { count: 40, windowMs: 10 * 60_000 };

export const scanEnabled = () => String(process.env.LICENSE_SCAN || "").toLowerCase() !== "off";

const fail = (status, message) => Object.assign(new Error(message), { status });

/* ------------------------------------------------------------------ */
/* The default engine: sharp to clean the picture, Tesseract to read it */
/* ------------------------------------------------------------------ */

let workerPromise = null;
let idleTimer = null;

async function loadWorker() {
  const { createWorker } = await import("tesseract.js");
  // The English data ships in the package, so nothing is fetched at runtime.
  const langPath = path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
  return createWorker("eng", 1, { langPath, gzip: true, cacheMethod: "none" });
}

async function worker() {
  workerPromise ??= loadWorker().catch((error) => {
    workerPromise = null;
    throw error;
  });
  return workerPromise;
}

async function releaseWorker() {
  const pending = workerPromise;
  workerPromise = null;
  clearTimeout(idleTimer);
  if (!pending) return;
  try {
    await (await pending).terminate();
  } catch {
    /* already gone */
  }
}

const keepWorkerWarm = () => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(releaseWorker, IDLE_RELEASE_MS);
  idleTimer.unref?.();
};

/*
 * Two passes that differ in how the picture is treated AND in how the engine
 * is told to look at it, because a card photographed under glare or over a
 * holographic background reads well one way and badly the other, and which is
 * not knowable beforehand. The second only runs when the first did not find
 * both the number and the expiry.
 *
 * Chosen by running both against the same cards, not by habit. Sharpening was
 * tried and left out: on a soft photo it made the engine worse, not better.
 * Local contrast (CLAHE) cannot be combined with sharpening in one sharp
 * pipeline in any case — it throws.
 */
const PASSES = [
  { name: "plain", psm: "3", prepare: (img) => img.grayscale().normalize() },
  { name: "local-contrast", psm: "11", prepare: (img) => img.grayscale().clahe({ width: 64, height: 64, maxSlope: 3 }) },
];

async function recognise(filePath, pass) {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    throw fail(503, "Automatic reading is not available on this server. Try again after OCR support is restored.");
  }

  // Only a failure to DECODE means "not a photo we can read" (a HEIC without a
  // decoder, a corrupt file). Anything that goes wrong after this is a bug, and
  // must surface as one rather than be filed under the user's bad photo.
  try {
    await sharp(filePath, { failOn: "none", limitInputPixels: 80_000_000 }).metadata();
  } catch {
    return null;
  }

  // Honour the camera's rotation and bring it to a size text can be read at.
  const image = await pass
    .prepare(
      sharp(filePath, { failOn: "none", limitInputPixels: 80_000_000 })
        .rotate()
        .resize({ width: 2400, height: 2400, fit: "inside" })
    )
    .png()
    .toBuffer();

  const w = await worker();
  // A PNG from here carries no resolution, which makes the engine guess and
  // warn on every scan.
  await w.setParameters({ tessedit_pageseg_mode: pass.psm, user_defined_dpi: "300" });
  const { data } = await w.recognize(image);
  return { text: data.text || "", confidence: Math.round(data.confidence || 0) };
}

let engine = { recognise };

/** Replace the engine in tests. Pass nothing to put the real one back. */
export function __setEngine(fake) {
  engine = fake ?? { recognise };
}

/* ------------------------------------------------------------------ */
/* One at a time, bounded, and killable                                */
/* ------------------------------------------------------------------ */

let tail = Promise.resolve();
let waiting = 0;

function inTurn(job, busyMessage = "Licence reading is busy right now. Try again in a moment.") {
  if (waiting >= MAX_WAITING) {
    return Promise.reject(fail(503, busyMessage));
  }
  waiting += 1;
  const run = tail.then(job, job);
  tail = run.catch(() => {}).finally(() => { waiting -= 1; });
  return run;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(fail(504, "Reading that photo took too long. Try a clearer, closer photo.")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/*
 * The same engine, queue and timeout for other paper the app photographs
 * (receipts: shared/receiptScan). One worker for the whole server, so a driver
 * scanning a fuel receipt waits behind an office scanning a licence rather than
 * running a second engine beside it.
 */

/** One pass of the engine over a file: { text, confidence }, or null when it is not a picture. */
export const recognisePass = (filePath, pass) => engine.recognise(filePath, pass);

/** The picture treatments the engine is tried with, in order. */
export const OCR_PASSES = PASSES;

/**
 * Run `job` in turn with every other scan, killed after `timeoutMs`. A job that
 * fails or hangs takes the engine down with it, so the next one starts clean.
 */
export function ocrJob(job, { timeoutMs = SCAN_TIMEOUT_MS, busyMessage } = {}) {
  return inTurn(
    () =>
      withTimeout(job(), timeoutMs)
        .catch(async (error) => {
          await releaseWorker();
          throw error;
        })
        .finally(keepWorkerWarm),
    busyMessage
  );
}

/* ------------------------------------------------------------------ */
/* Allowance                                                           */
/* ------------------------------------------------------------------ */

const spent = new Map(); // who -> [timestamps]

/** Take one scan from this person's allowance. False when they have none left. */
export function takeAllowance(who, now = Date.now()) {
  const recent = (spent.get(who) || []).filter((t) => now - t < ALLOWANCE.windowMs);
  if (recent.length >= ALLOWANCE.count) {
    spent.set(who, recent);
    return false;
  }
  recent.push(now);
  spent.set(who, recent);
  // keep the map from growing for ever across a long-running process
  if (spent.size > 5000) {
    for (const [key, times] of spent) if (!times.some((t) => now - t < ALLOWANCE.windowMs)) spent.delete(key);
  }
  return true;
}

export const __resetAllowance = () => spent.clear();

/* ------------------------------------------------------------------ */
/* The scan                                                            */
/* ------------------------------------------------------------------ */

const FIELDS = ["licenseNo", "firstName", "lastName", "licenseType", "licenseExpiry"];

/** Combine two passes: each field from whichever read it, preferring the surer reading. */
function merge(a, b) {
  if (!a) return b;
  const fields = {};
  const confidence = {};
  for (const key of FIELDS) {
    const first = a.fields[key];
    const second = b.fields[key];
    const pickSecond = !first || (second && a.confidence[key] !== "high" && b.confidence[key] === "high");
    fields[key] = pickSecond ? second ?? null : first;
    confidence[key] = pickSecond ? b.confidence[key] : a.confidence[key];
    if (!fields[key]) delete confidence[key];
  }
  const found = Object.values(fields).filter(Boolean).length;
  return { recognised: a.recognised || b.recognised, fields, confidence, found };
}

const enough = (p) => Boolean(p?.fields.licenseNo && p?.fields.licenseExpiry);

async function read(filePath) {
  let combined = null;
  let readable = false;
  for (const pass of PASSES) {
    // eslint-disable-next-line no-await-in-loop
    const out = await engine.recognise(filePath, pass);
    if (!out) continue;
    readable = true;
    combined = merge(combined, parseLicenseText(out.text));
    if (enough(combined)) break;
  }
  return { combined, readable };
}

/**
 * Read one uploaded file. Never throws for "could not read it" — that is an
 * answer, returned as a status. It throws (with .status) only for the things
 * the caller should refuse: busy, out of allowance, too slow.
 *
 * @param {{ path: string, mimetype: string }} file  as multer hands it over
 * @param {string} who  who is asking, for the allowance
 * @param {{ keep?: boolean }} [options]  keep: leave the file in place (the caller stores or discards it)
 * @returns {Promise<{
 *   status: "read"|"not_a_licence"|"unsupported"|"unavailable",
 *   message?: string, fields?: object, confidence?: object, found?: number,
 *   expired?: boolean|null, daysLeft?: number|null
 * }>}
 *
 * The engine failing to start is also an answer ("unavailable"), not a 500,
 * so the caller can show a precise retry message.
 */
export async function scanUpload(file, who, { now = new Date(), timeoutMs = SCAN_TIMEOUT_MS, keep = false } = {}) {
  try {
    if (!file) throw fail(400, "No licence photo was attached.");
    if (!scanEnabled()) {
      return { status: "unavailable", message: "Automatic reading is turned off. Ask a system administrator to enable it before saving this licence." };
    }
    if (file.mimetype === "application/pdf") {
      return {
        status: "unsupported",
        message: "A PDF cannot be read by the API. Upload a JPG or PNG image of the licence.",
      };
    }
    if (!takeAllowance(who)) {
      throw fail(429, "That is a lot of scans in a short while. Wait a few minutes and try again.");
    }

    let outcome;
    try {
      outcome = await ocrJob(() => read(file.path), { timeoutMs });
    } catch (error) {
      if (error?.status) throw error;
      // The engine would not start or crashed. The caller presents a retry.
      console.error(`[license-scan] Could not read a licence photo: ${error?.message || error}`);
      return { status: "unavailable", message: "Automatic reading is not working right now. Try again shortly." };
    }
    const { combined, readable } = outcome;

    if (!readable) {
      return {
        status: "unsupported",
        message: "That file could not be opened as a photo. Try a JPG or PNG image.",
      };
    }
    if (!combined.recognised && combined.found === 0) {
      return {
        status: "not_a_licence",
        message: "That does not look like a driver's licence, or the photo is too blurry to read. Take it again in good light with the whole card in view.",
      };
    }
    const daysLeft = daysUntilExpiry(combined.fields.licenseExpiry, now);
    return {
      status: "read",
      fields: combined.fields,
      confidence: combined.confidence,
      found: combined.found,
      expired: daysLeft === null ? null : daysLeft < 0,
      daysLeft,
    };
  } finally {
    // A scan is not a save: the picture goes whether or not it could be read —
    // unless the caller is registering the licence and is about to store it.
    if (file?.path && !keep) discard(file.path);
  }
}

/** For shutdown and tests. */
export const __releaseEngine = releaseWorker;
