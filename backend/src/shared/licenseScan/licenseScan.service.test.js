import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  scanUpload, __setEngine, __resetAllowance, takeAllowance, ALLOWANCE, MAX_WAITING,
} from "./licenseScan.service.js";

/*
 * The engine is replaced here: reading a real photograph depends on fonts, a
 * native library and a second of CPU, none of which belongs in a unit suite.
 * What these pin down is everything AROUND the reading — that the upload never
 * outlives the scan, that a broken engine is an answer and not a crash, that
 * scanning cannot be used to burn the server, and that one bad photo cannot
 * wedge it for the next person.
 */

const NOW = new Date("2026-10-15T04:00:00Z");

const CARD = `
LAND TRANSPORTATION OFFICE
DRIVER'S LICENSE
Last Name, First Name, Middle Name
DELA CRUZ, JUAN SANTOS
Date of Birth
1990/01/15
License No. Expiration Date
N01-12-345678 2027/01/15
`;

let made = [];
function upload(mimetype = "image/jpeg") {
  const file = path.join(os.tmpdir(), `scan-test-${process.pid}-${Math.random().toString(36).slice(2)}.jpg`);
  fs.writeFileSync(file, "not really a picture");
  made.push(file);
  return { path: file, mimetype, size: 20 };
}
const gone = async (file) => {
  await new Promise((r) => setTimeout(r, 30)); // discard() is fire-and-forget
  return !fs.existsSync(file.path);
};

beforeEach(() => { __resetAllowance(); delete process.env.LICENSE_SCAN; });
afterEach(() => {
  __setEngine(null);
  for (const f of made) fs.rmSync(f, { force: true });
  made = [];
  delete process.env.LICENSE_SCAN;
});

const engineReturning = (...texts) => {
  const calls = [];
  __setEngine({
    recognise: async (_file, pass) => {
      calls.push(pass.name);
      const text = texts[Math.min(calls.length - 1, texts.length - 1)];
      return text === null ? null : { text, confidence: 90 };
    },
  });
  return calls;
};

test("a readable licence comes back with its fields, and the upload is deleted", async () => {
  engineReturning(CARD);
  const file = upload();
  const r = await scanUpload(file, "staff:1", { now: NOW });
  assert.equal(r.status, "read");
  assert.equal(r.fields.licenseNo, "N01-12-345678");
  assert.equal(r.fields.licenseExpiry, "2027-01-15");
  assert.equal(r.expired, false);
  assert.equal(r.daysLeft, 92);
  assert.equal(await gone(file), true);
});

test("an expired licence is reported as expired, with how long ago", async () => {
  engineReturning(CARD.replace("2027/01/15", "2026/10/01"));
  const r = await scanUpload(upload(), "staff:1", { now: NOW });
  assert.equal(r.expired, true);
  assert.equal(r.daysLeft, -14);
});

test("the second pass runs only when the first did not find both the number and the expiry", async () => {
  const calls = engineReturning(CARD);
  await scanUpload(upload(), "staff:1", { now: NOW });
  assert.deepEqual(calls, ["plain"]);

  __resetAllowance();
  const calls2 = engineReturning("DRIVER'S LICENSE\nLAND TRANSPORTATION OFFICE", CARD);
  const r = await scanUpload(upload(), "staff:1", { now: NOW });
  assert.deepEqual(calls2, ["plain", "local-contrast"]);
  assert.equal(r.fields.licenseNo, "N01-12-345678");
});

test("two passes are combined: each field from whichever pass read it", async () => {
  engineReturning(
    "LAND TRANSPORTATION OFFICE\nLicense No.\nN01-12-345678",
    "LAND TRANSPORTATION OFFICE\nExpiration Date\n2028/02/02"
  );
  const r = await scanUpload(upload(), "staff:1", { now: NOW });
  assert.equal(r.fields.licenseNo, "N01-12-345678");
  assert.equal(r.fields.licenseExpiry, "2028-02-02");
});

test("something that is not a licence says so", async () => {
  engineReturning("Total 1,250.00\nThank you");
  const file = upload();
  const r = await scanUpload(file, "staff:1", { now: NOW });
  assert.equal(r.status, "not_a_licence");
  assert.match(r.message, /does not look like a driver/);
  assert.equal(await gone(file), true);
});

test("a PDF is saved-able but not read, and is not sent to the engine", async () => {
  const calls = engineReturning(CARD);
  const file = upload("application/pdf");
  const r = await scanUpload(file, "staff:1", { now: NOW });
  assert.equal(r.status, "unsupported");
  assert.match(r.message, /PDF/);
  assert.deepEqual(calls, []);
  assert.equal(await gone(file), true);
});

test("a file that cannot be opened as a picture is reported, not crashed on", async () => {
  engineReturning(null);
  const r = await scanUpload(upload(), "staff:1", { now: NOW });
  assert.equal(r.status, "unsupported");
});

test("a broken engine is reported as unavailable, never an opaque 500", async () => {
  __setEngine({ recognise: async () => { throw new Error("wasm failed to load"); } });
  const file = upload();
  const real = console.error;
  console.error = () => {};
  try {
    const r = await scanUpload(file, "staff:1", { now: NOW });
    assert.equal(r.status, "unavailable");
  } finally {
    console.error = real;
  }
  assert.equal(await gone(file), true);
});

test("no file is a 400", async () => {
  await assert.rejects(scanUpload(null, "staff:1"), (e) => e.status === 400);
});

test("LICENSE_SCAN=off turns it off, and still removes the upload", async () => {
  process.env.LICENSE_SCAN = "off";
  const calls = engineReturning(CARD);
  const file = upload();
  const r = await scanUpload(file, "staff:1", { now: NOW });
  assert.equal(r.status, "unavailable");
  assert.deepEqual(calls, []);
  assert.equal(await gone(file), true);
});

test("a person has an allowance, and it is theirs alone", async () => {
  engineReturning(CARD);
  for (let i = 0; i < ALLOWANCE.count; i += 1) {
    await scanUpload(upload(), "driver:7", { now: NOW });
  }
  const file = upload();
  await assert.rejects(scanUpload(file, "driver:7", { now: NOW }), (e) => e.status === 429);
  assert.equal(await gone(file), true);
  // somebody else is unaffected
  assert.equal((await scanUpload(upload(), "driver:8", { now: NOW })).status, "read");
});

test("the allowance comes back as time passes", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < ALLOWANCE.count; i += 1) assert.equal(takeAllowance("x", t0), true);
  assert.equal(takeAllowance("x", t0 + 1000), false);
  assert.equal(takeAllowance("x", t0 + ALLOWANCE.windowMs + 1), true);
});

test("a scan that hangs is cut off, and the next one still works", async () => {
  __setEngine({ recognise: () => new Promise(() => {}) }); // never answers
  const stuck = upload();
  await assert.rejects(scanUpload(stuck, "staff:1", { now: NOW, timeoutMs: 40 }), (e) => e.status === 504);
  assert.equal(await gone(stuck), true);

  engineReturning(CARD);
  assert.equal((await scanUpload(upload(), "staff:2", { now: NOW })).status, "read");
});

test("scans queue one at a time, and past a short queue callers are told to wait", async () => {
  let running = 0;
  let peak = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  __setEngine({
    recognise: async () => {
      running += 1;
      peak = Math.max(peak, running);
      await gate;
      running -= 1;
      return { text: CARD, confidence: 90 };
    },
  });

  // one running + MAX_WAITING - 1 queued fills the line
  const inLine = Array.from({ length: MAX_WAITING }, (_, i) => scanUpload(upload(), `who:${i}`, { now: NOW }));
  await new Promise((r) => setTimeout(r, 20));

  const extra = upload();
  await assert.rejects(scanUpload(extra, "who:extra", { now: NOW }), (e) => e.status === 503);
  assert.equal(await gone(extra), true);

  release();
  const results = await Promise.all(inLine);
  assert.ok(results.every((r) => r.status === "read"));
  assert.equal(peak, 1, "only one scan may run at a time");
});
