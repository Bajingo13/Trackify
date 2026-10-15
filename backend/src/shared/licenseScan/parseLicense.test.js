import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLicenseText, findLicenseNo, findDates, titleCase } from "./parseLicense.js";

/**
 * What these guard is not that a clean card is read — that is the easy case —
 * but that a card read badly is read honestly: a birth date is never offered as
 * an expiry, ordinary words never pass for a licence number, and a guess is
 * marked as one so the screen can ask the person to check it.
 */

const NOW = new Date("2026-10-15T00:00:00Z");
const parse = (text) => parseLicenseText(text, { now: NOW });

const CARD = `
REPUBLIC OF THE PHILIPPINES
LAND TRANSPORTATION OFFICE
DRIVER'S LICENSE

Last Name, First Name, Middle Name

DELA CRUZ, JUAN SANTOS
Nationality Sex Date of Birth Weight (kg) Height (m)
PHL M 1990/01/15 70 1.70

License No. Expiration Date Agency Code
N01-12-345678 2027/01/15 N01
DL Codes Conditions

A, A1, B NONE
`;

test("a clean card gives the number, name and expiry, all with confidence", () => {
  const r = parse(CARD);
  assert.equal(r.recognised, true);
  assert.deepEqual(r.fields, {
    licenseNo: "N01-12-345678",
    firstName: "Juan Santos",
    lastName: "Dela Cruz",
    licenseType: null,
    licenseExpiry: "2027-01-15",
  });
  assert.equal(r.confidence.licenseNo, "high");
  assert.equal(r.confidence.licenseExpiry, "high");
  assert.equal(r.expired, false);
});

test("the birth date is never mistaken for the expiry", () => {
  const r = parse(CARD);
  assert.notEqual(r.fields.licenseExpiry, "1990-01-15");
});

test("letters an OCR swaps for digits are put right", () => {
  const r = parse(`
    Last Name, First Name, Middle Name
    REYES, MARIA
    Date of Birth
    1985/O3/22
    License No. Expiration Date
    NO1-I2-345G78 2O27/O1/15
  `);
  // G is not one the engine commonly confuses for a digit, so the number is
  // not invented: it is left unread rather than misread.
  assert.equal(r.fields.licenseNo, null);

  const ok = parse(`
    License No. Expiration Date
    NO1-I2-345678 2O27/O1/15
  `);
  assert.equal(ok.fields.licenseNo, "N01-12-345678");
  assert.equal(ok.fields.licenseExpiry, "2027-01-15");
});

test("a number whose hyphens were lost is still found when it is made of real digits", () => {
  assert.equal(findLicenseNo("License No. N01 12 345678").value, "N01-12-345678");
  assert.equal(findLicenseNo("N0112345678").value, "N01-12-345678");
});

test("a letter the engine doubled up on is dropped, and the reading is a guess", () => {
  // seen on a real run: "N01" came back as "NO01"
  assert.deepEqual(findLicenseNo("NO01-12-345678"), { value: "N01-12-345678", strict: false });
  const r = parse("LAND TRANSPORTATION OFFICE\nLicense No. Expiration Date\nNO01-12-345678 2027/01/15");
  assert.equal(r.fields.licenseNo, "N01-12-345678");
  assert.equal(r.confidence.licenseNo, "low");
});

test("a clean reading is preferred over a doubled one elsewhere on the card", () => {
  assert.deepEqual(findLicenseNo("NO01-12-345678\nN01-12-345678"), { value: "N01-12-345678", strict: true });
});

test("ordinary capitalised words do not pass for a licence number", () => {
  assert.equal(findLicenseNo("BOSSISSOBBOISS"), null);
  assert.equal(findLicenseNo("ADDRESS 123 BOISSO ST"), null);
  assert.equal(findLicenseNo("SOBBIS-OSBS-BISSBO"), null);
});

test("inline labels work as well as a label row above the value", () => {
  const r = parse(`
    DRIVER'S LICENSE
    License No: D12-34-567890
    Expiration Date: 2028/06/30
  `);
  assert.equal(r.fields.licenseNo, "D12-34-567890");
  assert.equal(r.fields.licenseExpiry, "2028-06-30");
  assert.equal(r.confidence.licenseExpiry, "high");
});

test("two labels and two dates on separate lines are paired in order", () => {
  const r = parse(`
    Date of Birth Expiration Date
    1991/05/05 2029/05/05
  `);
  assert.equal(r.fields.licenseExpiry, "2029-05-05");
});

test("with no usable label the latest plausible date is offered, marked low confidence", () => {
  const r = parse(`
    DRIVER'S LICENSE
    1988/02/10
    2027/09/09
  `);
  assert.equal(r.fields.licenseExpiry, "2027-09-09");
  assert.equal(r.confidence.licenseExpiry, "low");
});

test("a date that cannot exist is rejected rather than rounded", () => {
  assert.deepEqual(findDates("2027/02/30"), []);
  assert.deepEqual(findDates("2027/13/01"), []);
});

test("an implausible year is not offered as the expiry", () => {
  // 1927 for 2027 is a one-character OCR slip, and 2087 is no licence
  const r = parse(`
    Expiration Date
    1927/01/15
  `);
  assert.equal(r.fields.licenseExpiry, null);
  assert.equal(parse("Expiration Date\n2087/01/15").fields.licenseExpiry, null);
});

test("day-first and month-first are told apart when the numbers allow it", () => {
  assert.equal(findDates("25/03/2027")[0].iso, "2027-03-25");
  assert.equal(findDates("03/25/2027")[0].iso, "2027-03-25");
  assert.equal(findDates("15 JAN 2027")[0].iso, "2027-01-15");
  assert.equal(findDates("January 15, 2027")[0].iso, "2027-01-15");
});

test("a date that could be read either way round is flagged, and low confidence", () => {
  assert.equal(findDates("03/04/2027")[0].ambiguous, true);
  const r = parse("Expiration Date\n03/04/2027");
  assert.equal(r.fields.licenseExpiry, "2027-03-04");
  assert.equal(r.confidence.licenseExpiry, "low");
});

test("an expired licence says so", () => {
  const r = parse("Expiration Date\n2026/03/01\nLicense No.\nN01-12-345678");
  assert.equal(r.fields.licenseExpiry, "2026-03-01");
  assert.equal(r.expired, true);
});

test("a licence expiring today is not yet expired", () => {
  assert.equal(parse("Expiration Date\n2026/10/15").expired, false);
});

test("names: surname first, title-cased, hyphens and apostrophes kept", () => {
  const r = parse("Last Name, First Name, Middle Name\nO'BRIEN-SMITH, MARY ANN");
  assert.equal(r.fields.lastName, "O'Brien-Smith");
  assert.equal(r.fields.firstName, "Mary Ann");
  assert.equal(r.confidence.lastName, "high");
});

test("a name with no label is found by its shape, and marked low confidence", () => {
  const r = parse("DRIVER'S LICENSE\nSANTOS, PEDRO");
  assert.equal(r.fields.lastName, "Santos");
  assert.equal(r.confidence.lastName, "low");
});

test("headings are not taken for a name", () => {
  const r = parse("REPUBLIC OF THE PHILIPPINES, DEPARTMENT OF TRANSPORTATION\nLAND TRANSPORTATION OFFICE");
  assert.equal(r.fields.lastName, null);
});

test("suffixes are kept sensibly", () => {
  assert.equal(titleCase("REYES JR"), "Reyes Jr.");
  assert.equal(titleCase("GARCIA III"), "Garcia III");
});

test("the licence type is read only when it is printed", () => {
  assert.equal(parse("NON-PROFESSIONAL\nDRIVER'S LICENSE").fields.licenseType, "Non-Professional");
  assert.equal(parse("NON PROFESSIONAL DRIVER'S LICENSE").fields.licenseType, "Non-Professional");
  assert.equal(parse("PROFESSIONAL\nDRIVER'S LICENSE").fields.licenseType, "Professional");
  assert.equal(parse("STUDENT PERMIT").fields.licenseType, "Student");
  assert.equal(parse(CARD).fields.licenseType, null);
});

test("something that is not a licence is not recognised and yields nothing", () => {
  const r = parse("Delivery receipt\nTotal 1,250.00\nThank you for your business");
  assert.equal(r.recognised, false);
  assert.equal(r.found, 0);
  assert.equal(r.expired, null);
});

test("empty or missing text is handled", () => {
  assert.equal(parse("").found, 0);
  assert.equal(parse(null).found, 0);
  assert.equal(parse(undefined).recognised, false);
});
