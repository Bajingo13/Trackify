import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReceiptText } from "./parseReceipt.js";

/*
 * Receipts as the engine hands them back: upper and lower case mixed, the
 * peso sign lost or read as P, columns run together. What matters is the
 * figure the driver actually paid, never the cash handed over or the change.
 */

const NOW = new Date("2026-10-21T06:00:00Z");
const parse = (text) => parseReceiptText(text, { now: NOW });

test("a fuel receipt: the total, not the cash or change, and the litres in the description", () => {
  const { fields, confidence, recognised } = parse(`
PETRON
SAN ROQUE SERVICE STATION
VAT REG TIN 123-456-789-000
OFFICIAL RECEIPT
OR No: 0045821
Date: 10/20/2026 14:32
Pump 03 Nozzle 2
TURBO DIESEL
35.200 L @ 62.50/L
TOTAL P2,200.00
CASH 2,500.00
CHANGE 300.00
VATABLE SALES 1,964.29
VAT AMOUNT 235.71
`);
  assert.equal(recognised, true);
  assert.equal(fields.amount, 2200);
  assert.equal(confidence.amount, "high");
  assert.equal(fields.category, "fuel");
  assert.equal(confidence.category, "high");
  assert.equal(fields.merchant, "Petron");
  assert.equal(fields.description, "Petron — Turbo Diesel 35.200 L");
  assert.equal(fields.expenseDate, "2026-10-20");
  assert.equal(fields.receiptNo, "0045821");
});

test("a toll receipt names the vehicle class", () => {
  const { fields } = parse(`
NLEX CORPORATION
BALINTAWAK TOLL PLAZA
LANE 12  CLASS 2
ENTRY: BOCAUE
TOLL FEE: 327.00
TXN NO 88213-4421
2026-10-19 07:15
`);
  assert.equal(fields.category, "toll");
  assert.equal(fields.amount, 327);
  assert.equal(fields.description, "NLEX Corporation — Toll fee, Class 2");
  assert.equal(fields.expenseDate, "2026-10-19");
  assert.equal(fields.receiptNo, "88213-4421");
});

test("a parking ticket", () => {
  const { fields } = parse(`
SM CITY CEBU
PARKING
Plate: ABC 1234
TIME IN 10/21/2026 08:02
TIME OUT 10/21/2026 11:40
DURATION 3 HRS
AMOUNT 70.00
`);
  assert.equal(fields.category, "parking");
  assert.equal(fields.amount, 70);
  assert.equal(fields.expenseDate, "2026-10-21");
});

test("a meal: the amount due, with a VAT-inclusive total line still counted", () => {
  const { fields } = parse(`
Jollibee
Digos Rizal Ave Branch
SALES INVOICE
SI# 000112233
1 CHICKENJOY W/ RICE 99.00
1 YUM BURGER 45.00
2 COKE 70.00
SUBTOTAL 214.00
TOTAL AMOUNT DUE (VAT INCL) 214.00
CASH 500.00
CHANGE 286.00
Oct 20, 2026
`);
  assert.equal(fields.category, "meals");
  assert.equal(fields.amount, 214);
  assert.equal(fields.merchant, "Jollibee");
  assert.equal(fields.description, "Jollibee — Meal");
  assert.equal(fields.expenseDate, "2026-10-20");
  assert.equal(fields.receiptNo, "000112233");
});

test("lodging and repair are told apart", () => {
  assert.equal(parse("GOLDEN PALM HOTEL\nROOM 204 1 NIGHT\nTOTAL 1,450.00").fields.category, "lodging");
  assert.equal(parse("JR VULCANIZING SHOP\nTIRE PATCH\nLABOR 150.00\nTOTAL 350.00").fields.category, "repair");
});

test("with no total line it falls back to the largest sum, and says it is unsure", () => {
  const { fields, confidence } = parse("KARINDERYA NI ALING NENA\nRICE 20.00\nADOBO 65.00\nSOFTDRINK 25.00\n110.00");
  assert.equal(fields.amount, 110);
  assert.equal(confidence.amount, "low");
  assert.equal(fields.category, "meals");
});

test("a thousands separator and a two-line total", () => {
  assert.equal(parse("SHELL\nGRAND TOTAL\n12,345.60").fields.amount, 12345.6);
});

test("dates in the future or long ago are not proposed; a day-first date still reads", () => {
  assert.equal(parse("TOTAL 100.00\n12/25/2026").fields.expenseDate, null);
  assert.equal(parse("TOTAL 100.00\n01/05/2024").fields.expenseDate, null);
  assert.equal(parse("TOTAL 100.00\n20/10/2026").fields.expenseDate, "2026-10-20");
});

test("a dotted date or a quantity is not taken for money", () => {
  const { fields } = parse("UNIOIL\n10.21.2026\nQTY 3\nTOTAL 500.00");
  assert.equal(fields.amount, 500);
});

test("text that is not a receipt proposes nothing to claim", () => {
  const out = parse("the quick brown fox\njumps over the lazy dog");
  assert.equal(out.recognised, false);
  assert.equal(out.fields.amount, null);
  assert.equal(out.fields.category, null);
});

test("an empty read", () => {
  const out = parse("");
  assert.equal(out.found, 0);
  assert.equal(out.recognised, false);
});
