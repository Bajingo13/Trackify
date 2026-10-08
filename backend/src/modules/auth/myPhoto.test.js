import "../../config/env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import db from "../../config/db.js";
import { UPLOAD_ROOT } from "../finance/receipts.storage.js";
import { myPhoto } from "./account.controller.js";

/**
 * GET /account/photo. Having no photograph is the normal state, so it answers an empty 200 —
 * not a 404 that every profile visit logged as a failure. A row whose
 * file has gone (an unmounted volume) is answered the same way.
 */

const SCRATCH = `test-myphoto-${process.pid}-${Date.now()}`;
after(() => fs.rmSync(path.join(UPLOAD_ROOT, SCRATCH), { recursive: true, force: true }));

function res() {
  const out = { ended: false, headers: {} };
  const r = {
    status(c) { out.statusCode = c; return r; },
    json(b) { out.body = b; out.ended = true; return r; },
    end() { out.ended = true; return r; },
    type(t) { out.type = t; return r; },
    set() { return r; },
    removeHeader() {},
    on() {},
    headersSent: false,
    // enough of a Writable for stream.pipe()
    write() { return true; }, once() { return r; }, emit() { return true; }, removeListener() { return r; },
  };
  out.res = r;
  return out;
}

async function ask(row) {
  const real = db.execute;
  db.execute = async () => [row ? [row] : []];
  try {
    const out = res();
    await myPhoto({ user: { userId: 9 } }, out.res);
    return out;
  } finally {
    db.execute = real;
  }
}

test("a user with no photograph gets an empty 200, not an error", async () => {
  const out = await ask({ photo_path: null, photo_mime: null });
  assert.equal(out.statusCode, 200);
  assert.equal(out.ended, true);
  assert.equal(out.body, undefined);
});

test("a user who does not exist also gets an empty 200", async () => {
  assert.equal((await ask(null)).statusCode, 200);
});

test("a photograph whose file is gone gets an empty 200, not a crash", async () => {
  const out = await ask({ photo_path: "avatars/2026/09/gone.jpg", photo_mime: "image/jpeg" });
  assert.equal(out.statusCode, 200);
  assert.equal(out.ended, true);
});

test("a path that escapes the upload root is treated as no photograph", async () => {
  const out = await ask({ photo_path: "../../etc/passwd", photo_mime: "image/jpeg" });
  assert.equal(out.statusCode, 200);
  assert.equal(out.ended, true);
});

test("a photograph that exists is sent", async () => {
  fs.mkdirSync(path.join(UPLOAD_ROOT, SCRATCH), { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_ROOT, SCRATCH, "me.jpg"), "x");
  const out = await ask({ photo_path: `${SCRATCH}/me.jpg`, photo_mime: "image/jpeg" });
  assert.equal(out.type, "image/jpeg");
  assert.equal(out.statusCode, undefined, "no error status was set");
});
