/**
 * Test helpers: a licence as the OCR engine would read it, and an "uploaded"
 * file for it. Used by tests only — reading a real photograph depends on fonts,
 * a native library and a second of CPU, none of which belongs in a unit suite.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { __setEngine, __resetAllowance } from "./licenseScan.service.js";

/** What Tesseract returns for a clean LTO card with these details. */
export const cardText = ({
  licenseNo = "N01-23-456789", expiry = "2028/01/01", last = "DELA CRUZ", first = "JUAN SANTOS", type = "",
} = {}) => `
REPUBLIC OF THE PHILIPPINES
LAND TRANSPORTATION OFFICE
${type}
DRIVER'S LICENSE
Last Name, First Name, Middle Name
${last}, ${first}
Date of Birth
1990/01/15
License No. Expiration Date
${licenseNo} ${expiry}
`;

/** Make the next scans read this text (or null for "could not open the file"). Returns the passes it was asked for. */
export function engineReads(text) {
  __resetAllowance();
  const calls = [];
  __setEngine({
    recognise: async (_file, pass) => {
      calls.push(pass.name);
      return text === null ? null : { text, confidence: 90 };
    },
  });
  return calls;
}

export const engineOff = () => __setEngine(null);

const made = [];
/** A file as multer hands it over: real, on disk, so "was it removed?" is a real question. */
export function uploadedLicence(mimetype = "image/jpeg") {
  const file = path.join(os.tmpdir(), `licence-fixture-${process.pid}-${Math.random().toString(36).slice(2)}.jpg`);
  fs.writeFileSync(file, "not really a picture");
  made.push(file);
  return { path: file, mimetype, size: 20, originalname: "card.jpg" };
}

export const stillThere = (file) => fs.existsSync(file.path);
/** discard() is fire-and-forget, so give it a moment before asking. */
export const goneSoon = async (file) => {
  await new Promise((r) => setTimeout(r, 40));
  return !fs.existsSync(file.path);
};
export const cleanUploads = () => { for (const f of made.splice(0)) fs.rmSync(f, { force: true }); };
