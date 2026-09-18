/**
 * Plus Codes (Open Location Code).
 *
 * A dispatcher shared a destination as "Q3HC+P3F, Alangilan, Batangas City" —
 * which is what Google Maps hands you when you share an exact spot, and a very
 * common way a precise Philippine location travels between people. No geocoder
 * resolves them, so the search fell back to the barangay and lost the exact
 * point that was sitting right there in the text.
 *
 * It does not need resolving. A Plus Code *is* the coordinates, written in
 * base 20 — decoding it is arithmetic, no lookup and no network. That makes it
 * the most precise thing anyone can type into the box, and the one case where
 * we can give back an exact pin for an address OpenStreetMap has never heard of.
 *
 * Implements the Open Location Code specification: five pairs of characters
 * encoding latitude and longitude alternately at decreasing resolution, then
 * optional refinement characters over a 4-column by 5-row grid. A short code
 * ("Q3HC+P3F") has its leading characters stripped and is recovered against a
 * nearby reference point — which is exactly what the rest of the typed address
 * gives us.
 */

const ALPHABET = "23456789CFGHJMPQRVWX";
const SEPARATOR = "+";
const SEPARATOR_POSITION = 8;
const PAIR_RESOLUTIONS = [20.0, 1.0, 0.05, 0.0025, 0.000125];
const GRID_COLUMNS = 4;
const GRID_ROWS = 5;
const MAX_DIGITS = 15;

/* A code is 2-8 characters, a "+", then 2-3 more. The alphabet deliberately
 * excludes vowels and easily confused letters, which is also what keeps this
 * from matching ordinary words in an address. */
const CODE_PATTERN = new RegExp(
  `\\b([${ALPHABET}]{2,8}\\${SEPARATOR}[${ALPHABET}]{2,3})\\b`,
  "i"
);

const clipLatitude = (lat) => Math.min(90, Math.max(-90, lat));

function normaliseLongitude(lng) {
  let value = lng;
  while (value < -180) value += 360;
  while (value >= 180) value -= 360;
  return value;
}

/** The Plus Code in this text, and whatever else was typed around it. */
export function findPlusCode(text) {
  const raw = String(text || "");
  const match = raw.match(CODE_PATTERN);
  if (!match) return null;
  const code = match[1].toUpperCase();
  const rest = raw.replace(match[1], " ").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "").trim();
  return { code, rest, short: code.indexOf(SEPARATOR) < SEPARATOR_POSITION };
}

/** Encode a point as a full Plus Code. Needed to recover a short one. */
export function encodePlusCode(latitude, longitude) {
  let lat = clipLatitude(latitude);
  const lng = normaliseLongitude(longitude);
  // A point exactly on the pole belongs to the cell below it.
  if (lat === 90) lat -= 1e-9;

  let latValue = lat + 90;
  let lngValue = lng + 180;
  let code = "";

  for (let i = 0; i < PAIR_RESOLUTIONS.length; i += 1) {
    const resolution = PAIR_RESOLUTIONS[i];
    const latDigit = Math.floor(latValue / resolution);
    const lngDigit = Math.floor(lngValue / resolution);
    code += ALPHABET[latDigit] + ALPHABET[lngDigit];
    latValue -= latDigit * resolution;
    lngValue -= lngDigit * resolution;
  }

  return `${code.slice(0, SEPARATOR_POSITION)}${SEPARATOR}${code.slice(SEPARATOR_POSITION)}`;
}

/**
 * Decode a full Plus Code to the centre of the area it names.
 *
 * The centre, not the corner: a code names a rectangle, and the corner is a
 * point nobody meant. At eleven characters that rectangle is about 3 by 4
 * metres, so the difference is small — but it is the difference between the
 * gate and the fence beside it.
 */
export function decodePlusCode(code) {
  const clean = String(code || "").toUpperCase().replace(/\+/g, "").replace(/0+$/, "");
  if (clean.length < 2) return null;
  for (const character of clean) if (!ALPHABET.includes(character)) return null;

  let lat = -90;
  let lng = -180;
  let latResolution = PAIR_RESOLUTIONS[0];
  let lngResolution = PAIR_RESOLUTIONS[0];

  const pairs = Math.min(clean.length, 10);
  for (let i = 0; i + 1 < pairs; i += 2) {
    latResolution = PAIR_RESOLUTIONS[i / 2];
    lngResolution = PAIR_RESOLUTIONS[i / 2];
    lat += ALPHABET.indexOf(clean[i]) * latResolution;
    lng += ALPHABET.indexOf(clean[i + 1]) * lngResolution;
  }

  for (let i = 10; i < Math.min(clean.length, MAX_DIGITS); i += 1) {
    latResolution /= GRID_ROWS;
    lngResolution /= GRID_COLUMNS;
    const value = ALPHABET.indexOf(clean[i]);
    lat += Math.floor(value / GRID_COLUMNS) * latResolution;
    lng += (value % GRID_COLUMNS) * lngResolution;
  }

  return {
    lat: lat + latResolution / 2,
    lng: lng + lngResolution / 2,
    latResolution,
    lngResolution,
  };
}

/**
 * Recover a short code against a nearby point.
 *
 * "Q3HC+P3F" is missing its first four characters, which cover a one-degree
 * square — roughly 110km. So it is unambiguous only near somewhere, and the
 * rest of the typed address ("Alangilan, Batangas City") is what supplies that
 * somewhere. If the naive result lands more than half a square from the
 * reference, the neighbouring square was meant instead.
 */
export function recoverPlusCode(shortCode, referenceLat, referenceLng) {
  const code = String(shortCode || "").toUpperCase();
  const separator = code.indexOf(SEPARATOR);
  if (separator < 0) return null;
  if (separator >= SEPARATOR_POSITION) return decodePlusCode(code);
  if (!Number.isFinite(referenceLat) || !Number.isFinite(referenceLng)) return null;

  const missing = SEPARATOR_POSITION - separator;
  const resolution = 20 ** (2 - missing / 2);
  const halfResolution = resolution / 2;

  const reference = encodePlusCode(referenceLat, referenceLng).replace(SEPARATOR, "");
  const decoded = decodePlusCode(reference.substring(0, missing) + code);
  if (!decoded) return null;

  let { lat, lng } = decoded;
  if (referenceLat + halfResolution < lat && lat - resolution >= -90) lat -= resolution;
  else if (referenceLat - halfResolution > lat && lat + resolution <= 90) lat += resolution;

  if (referenceLng + halfResolution < lng) lng -= resolution;
  else if (referenceLng - halfResolution > lng) lng += resolution;

  return { lat, lng };
}
