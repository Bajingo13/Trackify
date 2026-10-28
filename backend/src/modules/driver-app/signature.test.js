import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import db from "../../config/db.js";
import { deliverTrip } from "./driver.controller.js";
import { podUpload } from "../finance/receipts.storage.js";
import { up as migrate062 } from "../../../migrations/062_pod_signature.js";

/**
 * The receiver's signature on the proof of delivery (migration 062): stored
 * with its hash when given, required — or the reason there is none — when the
 * company says so, and never able to stop a delivery from landing on a
 * database that has not had 062 yet.
 */

const DRIVER = { driverId: 9, companyId: 7, branchId: 111, name: "QA Driver" };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

function file(name, bytes = PNG, mimetype = "image/png") {
  const p = path.join(os.tmpdir(), `trackify-sig-${process.pid}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.writeFileSync(p, bytes);
  return { path: p, mimetype, size: bytes.length };
}
const gone = async (p) => {
  for (let i = 0; i < 20 && fs.existsSync(p); i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 10));
  }
  return !fs.existsSync(p);
};
const capture = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return this; } });

/** One in-transit trip, the company's rule, and what gets written. */
function fakeDb({ required = false, missing062 = false } = {}) {
  const s = { pods: [], history: [], tripUpdates: 0 };
  const run = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.includes("require_signature AS required")) {
      if (missing062) throw Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" });
      return [[{ required: required ? 1 : 0 }]];
    }
    if (q.includes("SELECT tt.status, tt.branch_id")) return [[{ status: "in_transit", branch_id: 222 }]];
    if (q.startsWith("INSERT INTO trip_pod")) {
      if (missing062 && q.includes("signature_path")) throw Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" });
      s.pods.push({ sql: q, params });
      return [{}];
    }
    if (q.startsWith("INSERT INTO trip_status_history")) { s.history.push(params); return [{}]; }
    if (q.startsWith("UPDATE trip_tickets")) { s.tripUpdates += 1; return [{}]; }
    if (/^(INSERT|UPDATE|DELETE)/.test(q)) return [{}];
    return [[]];
  };
  const install = () => {
    const saved = { execute: db.execute, getConnection: db.getConnection };
    db.execute = run;
    db.getConnection = async () => ({ beginTransaction: async () => {}, execute: run, commit: async () => {}, rollback: async () => {}, release() {} });
    return () => { db.execute = saved.execute; db.getConnection = saved.getConnection; };
  };
  return { s, install };
}

const deliver = async (f, { body = {}, photo = file("pod.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"), signature = null } = {}) => {
  const restore = f.install();
  try {
    const res = capture();
    const req = {
      params: { id: "55" }, driver: DRIVER, context: {}, user: {}, headers: {}, socket: {},
      body: { receivedBy: "Ana Reyes", ...body },
      files: { photo: [photo], ...(signature ? { signature: [signature] } : {}) },
    };
    await deliverTrip(req, res);
    return { res, photo, signature };
  } finally {
    restore();
  }
};

test("a signature is stored with the POD, with its hash, and said in the timeline", async () => {
  const f = fakeDb();
  const sig = file("signature.png");
  const { res, photo } = await deliver(f, { signature: sig });
  assert.equal(res.statusCode, 200);
  const pod = f.s.pods[0];
  assert.match(pod.sql, /signature_path, signature_mime, signature_size, signature_sha256, signed_at, unsigned_reason/);
  assert.match(pod.sql, /NOW\(\), \?\)$/, "signed_at is the database's time");
  const [, , , , , , , , , , sigPath, mime, size, sha] = pod.params;
  assert.ok(sigPath);
  assert.equal(mime, "image/png");
  assert.equal(size, PNG.length);
  assert.equal(sha, crypto.createHash("sha256").update(PNG).digest("hex"));
  assert.match(f.s.history[0][6], /with photo and signature/);
  fs.rmSync(sig.path, { force: true });
  fs.rmSync(photo.path, { force: true });
});

test("a signature that is not a small PNG drawing is refused, and nothing is kept", async () => {
  for (const sig of [file("sig.jpg", Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg"), file("big.png", Buffer.alloc(201 * 1024, 1))]) {
    const f = fakeDb();
    // eslint-disable-next-line no-await-in-loop
    const { res, photo } = await deliver(f, { signature: sig });
    assert.equal(res.statusCode, 400);
    assert.equal(f.s.tripUpdates, 0);
    // eslint-disable-next-line no-await-in-loop
    assert.ok(await gone(sig.path));
    // eslint-disable-next-line no-await-in-loop
    assert.ok(await gone(photo.path));
  }
});

test("when required, a delivery without a signature or a reason is refused with a code the app acts on", async () => {
  const f = fakeDb({ required: true });
  const { res, photo } = await deliver(f);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "signature_required");
  assert.equal(f.s.tripUpdates, 0);
  assert.equal(f.s.pods.length, 0);
  assert.ok(await gone(photo.path));
});

test("when required, the reason there is no signature lets the delivery through, and is recorded", async () => {
  const f = fakeDb({ required: true });
  const { res, photo } = await deliver(f, { body: { unsignedReason: "refused" } });
  assert.equal(res.statusCode, 200);
  assert.equal(f.s.pods[0].params.at(-1), "refused");
  assert.match(f.s.history[0][6], /not signed: receiver refused/);
  fs.rmSync(photo.path, { force: true });
});

test("only the known reasons count; anything else is no reason at all", async () => {
  for (const unsignedReason of ["constructor", "toString", "maybe", ""]) {
    const f = fakeDb({ required: true });
    // eslint-disable-next-line no-await-in-loop
    const { res } = await deliver(f, { body: { unsignedReason } });
    assert.equal(res.statusCode, 400, unsignedReason);
  }
});

test("with the rule off and no signature, the POD is filed exactly as before", async () => {
  const f = fakeDb({ required: false });
  const { res, photo } = await deliver(f);
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(f.s.pods[0].sql, /signature/);
  fs.rmSync(photo.path, { force: true });
});

test("before migration 062 a signed delivery still lands, without the signature", async () => {
  const f = fakeDb({ missing062: true });
  const sig = file("signature.png");
  const { res, photo } = await deliver(f, { signature: sig });
  assert.equal(res.statusCode, 200);
  assert.equal(f.s.pods.length, 1);
  assert.doesNotMatch(f.s.pods[0].sql, /signature/);
  assert.ok(await gone(sig.path));
  fs.rmSync(photo.path, { force: true });
});

test("the office reads a signature with the right to read the trip", () => {
  const routes = fs.readFileSync(new URL("../operations/trips.routes.js", import.meta.url), "utf8");
  assert.ok(routes.includes('router.get("/:id/pod-signature", requirePermission("trip.read")'));
  // and the public tracking page never reads the POD at all
  const publicTrack = fs.readFileSync(new URL("../support/publicTrack.routes.js", import.meta.url), "utf8");
  assert.doesNotMatch(publicTrack, /trip_pod|signature/);
});

test("062 only adds, the rule off by default, and run twice changes nothing", async () => {
  const statements = [];
  const columns = new Set();
  const conn = {
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, " ").trim();
      statements.push(q);
      if (q.includes("information_schema.COLUMNS")) return [columns.has(`${params[0]}.${params[1]}`) ? [{ COLUMN_NAME: params[1] }] : []];
      const m = q.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/);
      if (m) columns.add(`${m[1]}.${m[2]}`);
      return [[]];
    },
  };
  await migrate062(conn);
  const alters = statements.filter((q) => q.startsWith("ALTER"));
  assert.equal(alters.length, 7);
  assert.ok(alters.every((q) => / ADD COLUMN /.test(q)));
  assert.ok(alters.some((q) => /require_signature TINYINT\(1\) NOT NULL DEFAULT 0/.test(q)));
  statements.length = 0;
  await migrate062(conn);
  assert.equal(statements.filter((q) => q.startsWith("ALTER")).length, 0);
});

/* ---------------------------------------------------------------- */
/* The upload itself: named files, each checked for what it really is */
/* ---------------------------------------------------------------- */

async function withServer(fn) {
  const app = express();
  app.post("/deliver", podUpload.fields([{ name: "photo", maxCount: 1 }, { name: "signature", maxCount: 1 }]), (req, res) => {
    const files = Object.values(req.files || {}).flat();
    res.json({ files: files.map((f) => ({ field: f.fieldname, mime: f.mimetype, path: f.path })) });
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ message: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}/deliver`);
  } finally {
    server.close();
  }
}

test("a photo and a signature upload together, each recognised for what it is", async () => {
  await withServer(async (url) => {
    const form = new FormData();
    form.append("photo", new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])], { type: "image/jpeg" }), "pod.jpg");
    form.append("signature", new Blob([PNG], { type: "image/png" }), "signature.png");
    const r = await fetch(url, { method: "POST", body: form });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.deepEqual(body.files.map((f) => [f.field, f.mime]), [["photo", "image/jpeg"], ["signature", "image/png"]]);
    body.files.forEach((f) => fs.rmSync(f.path, { force: true }));
  });
});

test("a page dressed as a signature is refused, and neither file is left behind", async () => {
  await withServer(async (url) => {
    const form = new FormData();
    form.append("photo", new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])], { type: "image/jpeg" }), "pod.jpg");
    form.append("signature", new Blob(["<html><script>alert(1)</script></html>"], { type: "image/png" }), "signature.png");
    const countBefore = fs.readdirSync(podUploadDir()).length;
    const r = await fetch(url, { method: "POST", body: form });
    assert.equal(r.status, 400);
    // give the unlinks a moment
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(fs.readdirSync(podUploadDir()).length, countBefore);
  });
});

function podUploadDir() {
  const root = process.env.UPLOAD_ROOT || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), "uploads");
  const dir = path.join(root, "pod");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
