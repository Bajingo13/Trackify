/**
 * Reading the text of a photographed receipt into an expense claim.
 *
 * The input is whatever the OCR engine made of the picture: uneven lines,
 * stray characters, columns run together. The output only ever PROPOSES a
 * claim. The driver sees every value in the form and can change it before
 * sending, and finance still reviews the claim against the photo. So when a
 * value is uncertain, this guesses and says how sure it is, and when a value
 * cannot be found it is left out. A missing amount is better than a wrong one.
 *
 * What it looks for:
 *   amount       the total paid. The "TOTAL" / "AMOUNT DUE" line wins over
 *                the largest number, and cash tendered and change are never it
 *   category     fuel, toll, parking, meals, lodging or repair, from the
 *                station, tollway and restaurant names and the words a
 *                receipt of that kind carries
 *   merchant     the business name printed at the top
 *   description  merchant plus what was bought, e.g. "Petron — Diesel 35.20 L"
 *   expenseDate  the date printed on it, if it is a real date, not in the future
 *                and not more than a year old
 *   receiptNo    the OR / SI / invoice number
 */

export const MAX_AMOUNT = 1_000_000;

const CATEGORY_LABEL = {
  fuel: "Fuel",
  toll: "Toll",
  parking: "Parking",
  meals: "Meals",
  lodging: "Lodging",
  repair: "Repair",
};

/*
 * [pattern, weight]. A brand or a word only one kind of receipt carries is
 * worth 3. A word that leans one way is worth 1 or 2. Every pattern is matched
 * against the upper-cased text.
 */
const SIGNS = {
  fuel: [
    [/\b(PETRON|SHELL|CALTEX|PHOENIX|SEAOIL|SEA OIL|CLEANFUEL|UNIOIL|FLYING V|JETTI|PTT|TOTALENERGIES)\b/, 3],
    [/\b(DIESEL|UNLEADED|GASOLINE|V-?POWER|BLAZE|XTRA ADVANCE|TURBO DIESEL|FUEL SAVE|PREMIUM 9[5-7])\b/, 3],
    [/\b(FUEL|PUMP|NOZZLE|LITERS?|LITRES?|LTRS?)\b/, 2],
    [/\d[.,]\d+\s*L\b/, 1],
  ],
  toll: [
    [/\b(TOLL|TOLLWAYS?|NLEX|SLEX|SKYWAY|TPLEX|CAVITEX|CALAX|MCX|STAR TOLLWAY|EASYTRIP|AUTOSWEEP)\b/, 3],
    [/\bCLASS\s*[123I]\b/, 2],
    [/\b(PLAZA|ENTRY|EXIT|LANE)\b/, 1],
  ],
  parking: [
    [/\bPARKING\b/, 3],
    [/\bTIME\s*(IN|OUT)\b/, 2],
    [/\b(DURATION|SLOT|HOURS?|HRS)\b/, 1],
  ],
  meals: [
    [/\b(JOLLIBEE|MC ?DONALD'?S?|CHOWKING|MANG INASAL|GREENWICH|KFC|MAX'?S|RED RIBBON|GOLDILOCKS|BURGER KING|SHAKEY'?S|ANDOK'?S|BONCHON|STARBUCKS|TOKYO TOKYO|YELLOW CAB)\b/, 3],
    [/\b(RESTAURANT|CAFE|EATERY|CARINDERIA|KARINDERYA|GRILL|FOOD|BAKESHOP)\b/, 2],
    [/\b(MEALS?|RICE|CHICKEN|BURGER|COFFEE|DINE[- ]?IN|TAKE[- ]?OUT|DRINKS?|SODA|SPAGHETTI|NOODLES|PORK|BEEF|FISH|SILOG)\b/, 1],
  ],
  lodging: [
    [/\b(HOTEL|LODGE|LODGING|PENSION|MOTEL|RESORT|INN|SUITES|HOSTEL|TRANSIENT)\b/, 3],
    [/\b(ROOM|CHECK[- ]?IN|CHECK[- ]?OUT)\b/, 2],
    [/\bNIGHTS?\b/, 1],
  ],
  repair: [
    [/\b(VULCANIZING|MECHANIC|AUTO REPAIR|REPAIR|OIL CHANGE|CHANGE OIL|AUTO SUPPLY|MOTOR WORKS)\b/, 3],
    [/\b(TIRES?|TYRES?|BATTERY|LABOU?R|ALIGNMENT|BRAKES?|SPARE PARTS)\b/, 2],
    [/\bPARTS\b/, 1],
  ],
};

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/*
 * A peso amount: two decimals, optional thousands separators, optional
 * currency mark (the engine reads "₱" as P, F or nothing). The two decimals
 * keep quantities, TINs, times and dates from being taken for money.
 */
const MONEY = /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)[.,](\d{2})(?!\d|[.,]\d)/g;

function amountsIn(line) {
  const out = [];
  for (const m of line.matchAll(MONEY)) {
    const value = Number(`${m[1].replace(/,/g, "")}.${m[2]}`);
    if (Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT) out.push(value);
  }
  return out;
}

// Lines whose amount is never what was spent.
const NOT_THE_TOTAL = /\b(SUB\s*-?\s*TOTAL|CASH|TENDER(ED)?|CHANGE|VATABLE|VAT\s*(AMOUNT|SALES|EXEMPT|12\s*%)|12\s*%\s*VAT|ZERO[- ]?RATED|DISCOUNT|TOTAL\s*(QTY|QUANTITY|ITEMS?|NO\.?\s*OF)|PRICE\s*\/|\/\s*L(ITER|ITRE)?\b|UNIT\s*PRICE|BALANCE|POINTS)\b/;

/* Best first. Each: [pattern, how sure]. */
const TOTAL_LINES = [
  [/\b(GRAND\s*TOTAL|TOTAL\s*AMOUNT\s*DUE|AMOUNT\s*DUE|TOTAL\s*DUE|TOTAL\s*AMOUNT|NET\s*AMOUNT|AMOUNT\s*PAYABLE|TOTAL\s*SALES?|TOTAL\s*PAID|AMOUNT\s*PAID)\b/, "high"],
  [/\bTOTAL\b/, "high"],
  [/\b(TOLL\s*FEE|PARKING\s*FEE|FARE|AMOUNT|AMT|FEE)\b/, "medium"],
];

function findAmount(lines) {
  for (const [pattern, confidence] of TOTAL_LINES) {
    const found = [];
    lines.forEach((line, i) => {
      if (!pattern.test(line) || NOT_THE_TOTAL.test(line)) return;
      // The figure is usually on the same line, rightmost. With the columns
      // read apart it lands on the next line instead.
      let here = amountsIn(line);
      if (!here.length && lines[i + 1] && !NOT_THE_TOTAL.test(lines[i + 1])) here = amountsIn(lines[i + 1]);
      if (here.length) found.push(here[here.length - 1]);
    });
    if (found.length) return { value: Math.max(...found), confidence };
  }

  // No total line was readable: the largest sum that is not cash or change.
  const loose = lines.filter((l) => !NOT_THE_TOTAL.test(l)).flatMap(amountsIn);
  return loose.length ? { value: Math.max(...loose), confidence: "low" } : null;
}

/* ------------------------------------------------------------------ */
/* Category                                                            */
/* ------------------------------------------------------------------ */

function findCategory(text) {
  const scores = Object.entries(SIGNS)
    .map(([category, signs]) => [category, signs.reduce((sum, [re, w]) => sum + (re.test(text) ? w : 0), 0)])
    .sort((a, b) => b[1] - a[1]);
  const [[best, top], [, second]] = scores;
  if (top === 0) return null;
  const confidence = top >= 3 && top - second >= 2 ? "high" : top >= 2 ? "medium" : "low";
  return { value: best, confidence };
}

/* ------------------------------------------------------------------ */
/* Merchant and description                                            */
/* ------------------------------------------------------------------ */

const NOT_A_NAME = /\b(OFFICIAL\s*RECEIPT|SALES\s*INVOICE|CHARGE\s*INVOICE|RECEIPT|INVOICE|TIN|VAT\s*REG|NON[- ]?VAT|MIN|S\/?N|PTU|ACCRED|TEL|CEL+|DATE|TIME|CASHIER|TERMINAL|POS|BRANCH|WELCOME|THANK)\b/;

// Names printed in capitals that stay in capitals.
const ACRONYMS = /^(NLEX|SLEX|TPLEX|CAVITEX|CALAX|MCX|SCTEX|SM|KFC|PTT|LTO|JR|II|III)$/;

const titleCase = (s) =>
  s
    .toLowerCase()
    .replace(/(^|[\s\-/&(.])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())
    .replace(/[A-Za-z]+/g, (w) => (ACRONYMS.test(w.toUpperCase()) ? w.toUpperCase() : w));

function findMerchant(lines) {
  for (const raw of lines.slice(0, 6)) {
    const line = raw.replace(/[^A-Za-z0-9&'.,\- ]/g, " ").replace(/\s+/g, " ").trim();
    const letters = (line.match(/[A-Za-z]/g) || []).length;
    if (letters < 3 || line.length > 48) continue;
    if (letters / line.replace(/ /g, "").length < 0.6) continue;
    if (NOT_A_NAME.test(line.toUpperCase())) continue;
    const name = line.replace(/[.,\- ]+$/, "");
    return name === name.toUpperCase() ? titleCase(name) : name;
  }
  return null;
}

const FUEL_PRODUCT = /\b(TURBO DIESEL|DIESEL|UNLEADED|GASOLINE|V-?POWER|BLAZE \d+|BLAZE|XTRA ADVANCE|PREMIUM 9[5-7]|FUEL SAVE)\b/;

function detailFor(category, text) {
  if (category === "fuel") {
    const product = text.match(FUEL_PRODUCT)?.[1];
    // litres: "35.200 L", "35.20 LTRS", "VOLUME 35.2"
    const litres =
      text.match(/(\d{1,3}[.,]\d{1,3})\s*(?:L|LTRS?|LITERS?|LITRES?)\b/)?.[1] ||
      text.match(/\b(?:VOLUME|VOL|QTY|LITERS?|LITRES?|LTRS?)\s*[:=]?\s*(\d{1,3}[.,]\d{1,3})\b/)?.[1];
    const parts = [product ? titleCase(product) : "Fuel", litres ? `${litres.replace(",", ".")} L` : null];
    return parts.filter(Boolean).join(" ");
  }
  if (category === "toll") {
    const vehicleClass = text.match(/\bCLASS\s*([123])\b/)?.[1];
    return vehicleClass ? `Toll fee, Class ${vehicleClass}` : "Toll fee";
  }
  if (category === "parking") return "Parking fee";
  if (category === "lodging") return "Lodging";
  if (category === "meals") return "Meal";
  if (category === "repair") return "Repair";
  return null;
}

function describe(merchant, category, text) {
  const detail = category ? detailFor(category, text) : null;
  const joined = [merchant, detail].filter(Boolean).join(" — ");
  return joined ? joined.slice(0, 255) : null;
}

/* ------------------------------------------------------------------ */
/* Date and receipt number                                             */
/* ------------------------------------------------------------------ */

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };

const pad = (n) => String(n).padStart(2, "0");

function realDate(y, m, d, now) {
  const year = y < 100 ? 2000 + y : y;
  const date = new Date(Date.UTC(year, m - 1, d));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  // A day of slack for the phone and the receipt printer disagreeing about midnight.
  if (date.getTime() > now.getTime() + 86_400_000) return null;
  if (date.getTime() < now.getTime() - 366 * 86_400_000) return null;
  return `${year}-${pad(m)}-${pad(d)}`;
}

function findDate(text, now) {
  const tries = [];
  // 2026-10-21, 2026/10/21
  for (const m of text.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) tries.push([+m[1], +m[2], +m[3]]);
  // 10/21/2026, 10-21-26: month first, as Philippine receipts print it
  for (const m of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g)) {
    tries.push([+m[3], +m[1], +m[2]]);
    tries.push([+m[3], +m[2], +m[1]]); // 21/10/2026, when month-first cannot be a date
  }
  // OCT 21, 2026 / OCT-21-2026
  for (const m of text.matchAll(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT?|OCT|NOV|DEC)[A-Z]*[ .\-/]*(\d{1,2}),?[ .\-/]*(20\d{2})\b/g)) {
    tries.push([+m[3], MONTHS[m[1]], +m[2]]);
  }
  // 21 OCT 2026
  for (const m of text.matchAll(/\b(\d{1,2})[ .\-/]*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT?|OCT|NOV|DEC)[A-Z]*[ .\-/,]*(20\d{2})\b/g)) {
    tries.push([+m[3], MONTHS[m[2]], +m[1]]);
  }
  for (const [y, m, d] of tries) {
    const date = realDate(y, m, d, now);
    if (date) return date;
  }
  return null;
}

const RECEIPT_NO =
  /\b(?:O\.?R\.?|S\.?I\.?|INVOICE|INV|RECEIPT|TRANS(?:ACTION)?|TXN|TICKET)\s*(?:NO\.?|NUMBER|NUM|#)\s*[:#.]?\s*([A-Z0-9][A-Z0-9-]{2,29})\b/;

function findReceiptNo(text) {
  const value = text.match(RECEIPT_NO)?.[1];
  return value && /\d/.test(value) ? value : null;
}

/* ------------------------------------------------------------------ */

/**
 * @param {string} rawText  what the OCR engine read
 * @param {{ now?: Date }} [options]
 * @returns {{
 *   recognised: boolean,
 *   fields: { amount: number|null, category: string|null, merchant: string|null,
 *             description: string|null, expenseDate: string|null, receiptNo: string|null },
 *   confidence: Record<string, "high"|"medium"|"low">,
 *   found: number
 * }}
 */
export function parseReceiptText(rawText, { now = new Date() } = {}) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const upperLines = lines.map((l) => l.toUpperCase());
  const text = upperLines.join("\n");

  const amount = findAmount(upperLines);
  const category = findCategory(text);
  const merchant = findMerchant(lines);
  const expenseDate = findDate(text, now);
  const receiptNo = findReceiptNo(text);
  const description = describe(merchant, category?.value, text);

  const fields = {
    amount: amount?.value ?? null,
    category: category?.value ?? null,
    merchant,
    description,
    expenseDate,
    receiptNo,
  };
  const confidence = {};
  if (amount) confidence.amount = amount.confidence;
  if (category) confidence.category = category.confidence;
  if (merchant) confidence.merchant = "medium";
  if (description) confidence.description = "medium";
  if (expenseDate) confidence.expenseDate = "high";
  if (receiptNo) confidence.receiptNo = "medium";

  const found = Object.values(fields).filter((v) => v != null).length;
  // Something only a receipt carries: a total line, an OR number, or a
  // recognised kind of expense together with a sum of money.
  const recognised =
    Boolean(amount && amount.confidence !== "low") || Boolean(receiptNo) || Boolean(category && amount);

  return { recognised, fields, confidence, found };
}

export const categoryLabel = (c) => CATEGORY_LABEL[c] || "Other";
