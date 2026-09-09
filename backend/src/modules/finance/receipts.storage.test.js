import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testRoot = path.join(os.tmpdir(), `trackify-storage-${process.pid}`);
process.env.UPLOAD_ROOT = testRoot;

const storage = await import("./receipts.storage.js");

before(async () => {
  await fs.promises.rm(testRoot, { recursive: true, force: true });
});

after(async () => {
  await fs.promises.rm(testRoot, { recursive: true, force: true });
});

test("upload storage creates writable receipt and POD directories", async () => {
  const result = await storage.verifyUploadStorage();
  assert.deepEqual(result, { ok: true, persistent: true, mode: "persistent" });
  assert.equal(fs.existsSync(path.join(testRoot, "receipts")), true);
  assert.equal(fs.existsSync(path.join(testRoot, "pod")), true);
});

test("stored attachment paths remain relative to the configured root", () => {
  const file = path.join(testRoot, "receipts", "2026", "09", "receipt.jpg");
  assert.equal(storage.toRelative(file), "receipts/2026/09/receipt.jpg");
  assert.equal(storage.toAbsolute("receipts/2026/09/receipt.jpg"), file);
});

test("attachment paths cannot escape the configured root", () => {
  assert.throws(() => storage.toAbsolute("../../secret.txt"), /Invalid attachment path/);
});
