/**
 * Reading a photographed receipt for the Driver App's claim form.
 *
 * Same engine, same single queue, same timeout and the same kind of allowance
 * as licence reading (shared/licenseScan), so a receipt costs this server no
 * more than a licence does and never runs a second engine beside it. Like a
 * licence scan, a receipt is read here and not sent to any outside service.
 *
 * A scan is not a claim. The upload is deleted as soon as it has been read,
 * whatever happens. The form keeps its own copy of the photo and attaches it
 * to the claim when the driver sends it, through the ordinary expense route,
 * which is also the one that works out of signal. What comes back only fills
 * in the form. The driver checks it, and finance reviews the claim as before.
 *
 * RECEIPT_SCAN=off turns it off without a code deploy. The form then says so
 * and the driver types the claim in.
 */
import { discard } from "../../modules/finance/receipts.storage.js";
import { ocrJob, recognisePass, OCR_PASSES, takeAllowance, SCAN_TIMEOUT_MS } from "../licenseScan/licenseScan.service.js";
import { parseReceiptText } from "./parseReceipt.js";

export const receiptScanEnabled = () => String(process.env.RECEIPT_SCAN || "").toLowerCase() !== "off";

const fail = (status, message) => Object.assign(new Error(message), { status });

const RANK = { high: 3, medium: 2, low: 1 };
const KEYS = ["amount", "category", "merchant", "description", "expenseDate", "receiptNo"];

/** Each field from whichever pass read it more surely. */
function merge(a, b) {
  if (!a) return b;
  const fields = {};
  const confidence = {};
  for (const key of KEYS) {
    const useB = a.fields[key] == null || (b.fields[key] != null && (RANK[b.confidence[key]] || 0) > (RANK[a.confidence[key]] || 0));
    const from = useB ? b : a;
    fields[key] = from.fields[key] ?? null;
    if (fields[key] != null) confidence[key] = from.confidence[key];
  }
  return {
    recognised: a.recognised || b.recognised,
    fields,
    confidence,
    found: Object.values(fields).filter((v) => v != null).length,
  };
}

const enough = (p) => p?.confidence.amount === "high" && Boolean(p?.fields.category);

async function read(filePath, now) {
  let combined = null;
  let readable = false;
  for (const pass of OCR_PASSES) {
    // eslint-disable-next-line no-await-in-loop
    const out = await recognisePass(filePath, pass);
    if (!out) continue;
    readable = true;
    combined = merge(combined, parseReceiptText(out.text, { now }));
    if (enough(combined)) break;
  }
  return { combined, readable };
}

/**
 * @param {{ path: string, mimetype: string }} file  as multer hands it over
 * @param {string} who  who is asking, for the allowance
 * @returns {Promise<{
 *   status: "read"|"not_a_receipt"|"unsupported"|"unavailable",
 *   message?: string, fields?: object, confidence?: object, found?: number
 * }>}
 * Throws (with .status) only for busy, out of allowance, or too slow.
 */
export async function scanReceipt(file, who, { now = new Date(), timeoutMs = SCAN_TIMEOUT_MS } = {}) {
  try {
    if (!file) throw fail(400, "No receipt photo was attached.");
    if (!receiptScanEnabled()) {
      return { status: "unavailable", message: "Reading receipts is turned off. Fill in the claim by hand." };
    }
    if (file.mimetype === "application/pdf") {
      return { status: "unsupported", message: "A PDF cannot be read. Take a photo of the receipt instead, or fill in the claim by hand." };
    }
    if (!takeAllowance(`receipt:${who}`)) {
      throw fail(429, "That is a lot of scans in a short while. Wait a few minutes, or fill in the claim by hand.");
    }

    let outcome;
    try {
      outcome = await ocrJob(() => read(file.path, now), {
        timeoutMs,
        busyMessage: "Receipt reading is busy right now. Try again in a moment, or fill in the claim by hand.",
      });
    } catch (error) {
      if (error?.status) throw error;
      console.error(`[receipt-scan] Could not read a receipt photo: ${error?.message || error}`);
      return { status: "unavailable", message: "Reading receipts is not working right now. Fill in the claim by hand." };
    }
    const { combined, readable } = outcome;

    if (!readable) {
      return { status: "unsupported", message: "That file could not be opened as a photo. Try a JPG or PNG image." };
    }
    if (!combined.recognised && combined.fields.amount == null) {
      return {
        status: "not_a_receipt",
        message: "Could not read a receipt in that photo. Take it again flat, in good light, with the whole receipt in view, or fill in the claim by hand.",
      };
    }
    return { status: "read", fields: combined.fields, confidence: combined.confidence, found: combined.found };
  } finally {
    if (file?.path) discard(file.path);
  }
}
