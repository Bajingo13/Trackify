import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../../config/db.js";
import { deliverTrip } from "./trips.controller.js";

const capture = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
});

test("dispatch cannot silently confirm delivery without a photo", async () => {
  const real = db.getConnection;
  let touched = false;
  db.getConnection = async () => { touched = true; throw new Error("must not reach the database"); };
  try {
    const res = capture();
    await deliverTrip({ body: { receivedBy: "Ana Reyes" }, context: { companyId: 1 } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "POD_OVERRIDE_REASON_REQUIRED");
    assert.match(res.body.message, /without the driver's photo/i);
    assert.equal(touched, false);
  } finally {
    db.getConnection = real;
  }
});
