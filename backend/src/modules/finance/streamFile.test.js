import "../../config/env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { UPLOAD_ROOT, streamFile, fileExists } from "./receipts.storage.js";

/**
 * Every download used createReadStream(abs).pipe(res) behind an existsSync
 * check. With no 'error' listener, a file that vanished between the check and
 * the open threw out of an event emitter — an uncaught exception, which ends
 * the process. These hold the replacement to: one bad file is one 404.
 */

const SCRATCH = `test-stream-${process.pid}-${Date.now()}`;
const dir = path.join(UPLOAD_ROOT, SCRATCH);
fs.mkdirSync(dir, { recursive: true });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function fakeRes() {
  const chunks = [];
  const res = new Writable({ write(chunk, _enc, cb) { chunks.push(chunk); this.headersSent = true; cb(); } });
  res.headersSent = false;
  res.removed = [];
  res.removeHeader = (h) => res.removed.push(h);
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; res.headersSent = true; res.end(); return res; };
  res.bytes = () => Buffer.concat(chunks).toString();
  return res;
}
const finished = (res) => new Promise((resolve) => res.on("finish", resolve).on("close", resolve));

test("a file that exists is sent", async () => {
  const abs = path.join(dir, "ok.txt");
  fs.writeFileSync(abs, "hello");
  const res = fakeRes();
  streamFile(res, abs);
  await finished(res);
  assert.equal(res.bytes(), "hello");
});

test("a file that vanished is a 404, not an uncaught exception", async () => {
  // Without an error listener this threw out of the event emitter.
  const uncaught = [];
  const onUncaught = (e) => uncaught.push(e);
  process.on("uncaughtException", onUncaught);
  try {
    const res = fakeRes();
    streamFile(res, path.join(dir, "never-existed.png"));
    await finished(res);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(res.statusCode, 404);
    assert.match(res.body.message, /missing from storage/);
    assert.deepEqual(uncaught, []);
  } finally {
    process.off("uncaughtException", onUncaught);
  }
});

test("a failed read drops the download headers that were set for the file", async () => {
  const res = fakeRes();
  streamFile(res, path.join(dir, "gone.pdf"));
  await finished(res);
  assert.ok(res.removed.includes("Content-Disposition"));
  assert.ok(res.removed.includes("Cache-Control"));
});

test("a path that is a directory is a server-side failure, reported as such", async () => {
  const res = fakeRes();
  streamFile(res, dir);
  await finished(res);
  assert.equal(res.statusCode, 500);
  assert.match(res.body.message, /could not be read/);
});

test("fileExists is false for a missing file, an escaping path and nothing at all", () => {
  fs.writeFileSync(path.join(dir, "here.txt"), "x");
  assert.equal(fileExists(`${SCRATCH}/here.txt`), true);
  assert.equal(fileExists(`${SCRATCH}/nope.txt`), false);
  assert.equal(fileExists("../../etc/passwd"), false);
  assert.equal(fileExists(null), false);
  assert.equal(fileExists(undefined), false);
});
