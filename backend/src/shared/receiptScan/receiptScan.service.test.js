import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { __setEngine, __resetAllowance, ALLOWANCE } from "../licenseScan/licenseScan.service.js";
import { scanReceipt } from "./receiptScan.service.js";

/*
 * The engine is the licence scanner's, replaced here as it is in that suite.
 * These pin down what is around the reading: the photo never outlives the
 * scan, every failure is an answer the form can act on, and the allowance is
 * the driver's own.
 */

const NOW = new Date("2026-10-21T06:00:00Z");
const RECEIPT = "PETRON\nDIESEL 20.000 L\nTOTAL 1,250.00\nCASH 1,500.00\nCHANGE 250.00\nOR NO 7781\n10/21/2026";

let made = [];
function upload(mimetype = "image/jpeg") {
  const file = path.join(os.tmpdir(), `receipt-test-${process.pid}-${Math.random().toString(36).slice(2)}.jpg`);
  fs.writeFileSync(file, "not really a picture");
  made.push(file);
  return { path: file, mimetype, size: 20 };
}
const gone = async (file) => {
  await new Promise((r) => setTimeout(r, 30)); // discard() is fire-and-forget
  return !fs.existsSync(file.path);
};
const engineReturning = (...texts) => {
  const calls = [];
  __setEngine({
    recognise: async (_file, pass) => {
      calls.push(pass.name);
      const text = texts[Math.min(calls.length - 1, texts.length - 1)];
      return text === null ? null : { text, confidence: 80 };
    },
  });
  return calls;
};

beforeEach(() => { __resetAllowance(); delete process.env.RECEIPT_SCAN; });
afterEach(() => {
  __setEngine(null);
  for (const f of made) fs.rmSync(f, { force: true });
  made = [];
  delete process.env.RECEIPT_SCAN;
});

test("reads a receipt in one pass when the total and the kind are clear, and deletes the photo", async () => {
  const calls = engineReturning(RECEIPT);
  const file = upload();
  const out = await scanReceipt(file, "driver:1", { now: NOW });
  assert.equal(out.status, "read");
  assert.equal(out.fields.amount, 1250);
  assert.equal(out.fields.category, "fuel");
  assert.equal(out.fields.receiptNo, "7781");
  assert.equal(out.fields.expenseDate, "2026-10-21");
  assert.deepEqual(calls, ["plain"]);
  assert.equal(await gone(file), true);
});

test("tries the second treatment when the first missed the total, keeping the best of each", async () => {
  const calls = engineReturning("PETRON\nDIESEL", "TOTAL 900.00");
  const out = await scanReceipt(upload(), "driver:1", { now: NOW });
  assert.equal(calls.length, 2);
  assert.equal(out.fields.amount, 900);
  assert.equal(out.fields.category, "fuel");
  assert.equal(out.fields.merchant, "Petron");
});

test("a photo with no receipt in it is an answer, not an error", async () => {
  engineReturning("hello world");
  const file = upload();
  const out = await scanReceipt(file, "driver:1", { now: NOW });
  assert.equal(out.status, "not_a_receipt");
  assert.match(out.message, /by hand/);
  assert.equal(await gone(file), true);
});

test("a PDF, an unreadable file, a broken engine and a switched-off scanner all say what to do", async () => {
  engineReturning(RECEIPT);
  assert.equal((await scanReceipt(upload("application/pdf"), "driver:1")).status, "unsupported");

  engineReturning(null);
  assert.equal((await scanReceipt(upload(), "driver:1")).status, "unsupported");

  __setEngine({ recognise: async () => { throw new Error("wasm failed"); } });
  assert.equal((await scanReceipt(upload(), "driver:1")).status, "unavailable");

  process.env.RECEIPT_SCAN = "off";
  const file = upload();
  assert.equal((await scanReceipt(file, "driver:1")).status, "unavailable");
  assert.equal(await gone(file), true);
});

test("a hung read is cut off and the photo still deleted", async () => {
  __setEngine({ recognise: () => new Promise(() => {}) });
  const file = upload();
  await assert.rejects(scanReceipt(file, "driver:1", { timeoutMs: 50 }), (e) => e.status === 504);
  assert.equal(await gone(file), true);
});

test("each driver has their own allowance, separate from licence scanning", async () => {
  engineReturning(RECEIPT);
  for (let i = 0; i < ALLOWANCE.count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await scanReceipt(upload(), "driver:7", { now: NOW });
  }
  await assert.rejects(scanReceipt(upload(), "driver:7", { now: NOW }), (e) => e.status === 429);
  assert.equal((await scanReceipt(upload(), "driver:8", { now: NOW })).status, "read");
});
