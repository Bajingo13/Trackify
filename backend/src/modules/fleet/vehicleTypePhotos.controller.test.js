import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import {
  listTypePhotos,
  uploadTypePhoto,
  removeTypePhoto,
} from "./vehicleTypePhotos.controller.js";

/**
 * A company's own photograph for a kind of vehicle.
 *
 * The thing worth guarding here is the scope. Every query is keyed on
 * req.context.companyId, and a vehicle type is free text that arrives in the
 * URL — so these tests hold the company filter in place and keep the type
 * bounded before it reaches a column.
 */

async function withDb(handler, fn) {
  const real = db.execute;
  const calls = [];
  db.execute = async (sql, params) => {
    calls.push({ sql, params });
    return handler(sql, params);
  };
  try {
    return await fn(calls);
  } finally {
    db.execute = real;
  }
}

function recorder() {
  const out = {};
  out.res = {
    status(code) { out.statusCode = code; return this; },
    json(value) { out.body = value; return this; },
  };
  return out;
}

const CONTEXT = { companyId: 7, branchId: 1 };

test("the manifest lists types and timestamps, not image bytes", async () => {
  // The client turns this into one request per type it has to draw. Returning
  // the images here would mean downloading every photo a company owns before
  // the first card renders.
  const r = recorder();
  await withDb(() => [[
    { vehicle_type: "Closed Van", photo_mime: "image/png", photo_size: 27928, updated_at: "2026-09-14T08:17:35.000Z" },
  ]], () => listTypePhotos({ context: CONTEXT }, r.res));

  assert.deepEqual(r.body.data, [{
    vehicleType: "Closed Van",
    mime: "image/png",
    bytes: 27928,
    updatedAt: "2026-09-14T08:17:35.000Z",
  }]);
  assert.equal(JSON.stringify(r.body).includes("photo_path"), false);
});

test("the manifest is scoped to the caller's company", async () => {
  const r = recorder();
  const calls = await withDb(() => [[]], async (calls) => {
    await listTypePhotos({ context: CONTEXT }, r.res);
    return calls;
  });

  assert.match(calls[0].sql, /WHERE company_id = \?/);
  assert.deepEqual(calls[0].params, [7]);
});

test("an upload with no file is refused before anything is written", async () => {
  const r = recorder();
  await withDb(() => { throw new Error("must not touch the database"); },
    () => uploadTypePhoto({ context: CONTEXT, params: { type: "Closed Van" }, file: null }, r.res));

  assert.equal(r.statusCode, 400);
});

test("a blank vehicle type is rejected rather than stored", async () => {
  await assert.rejects(
    () => withDb(() => [[]],
      () => uploadTypePhoto({ context: CONTEXT, params: { type: "   " }, file: {} }, recorder().res)),
    (e) => e.status === 400
  );
});

test("an over-long vehicle type is rejected rather than silently truncated", async () => {
  // The column is VARCHAR(100). Truncating instead of refusing would quietly
  // point two different type names at the same photograph.
  await assert.rejects(
    () => withDb(() => [[]],
      () => uploadTypePhoto({ context: CONTEXT, params: { type: "x".repeat(101) }, file: {} }, recorder().res)),
    (e) => e.status === 400
  );
});

test("removing a photo a company never set reports 404, not success", async () => {
  const r = recorder();
  await withDb(() => [[undefined]],
    () => removeTypePhoto({ context: CONTEXT, params: { type: "Wing Van" } }, r.res));

  assert.equal(r.statusCode, 404);
  assert.equal(r.body.success, false);
});
