import "../../config/env.js"; // trip-status.service pulls in the db pool at import
import { test } from "node:test";
import assert from "node:assert/strict";
import { TRANSITIONS } from "./trip-status.service.js";

test("lifecycle: transitions form a single forward chain to closed", () => {
  // release → start → deliver → close
  assert.deepEqual(TRANSITIONS.release.to, "released");
  assert.ok(TRANSITIONS.start.from.includes("released"));
  assert.deepEqual(TRANSITIONS.start.to, "in_transit");
  assert.ok(TRANSITIONS.deliver.from.includes("in_transit"));
  assert.deepEqual(TRANSITIONS.deliver.to, "delivered");
  assert.ok(TRANSITIONS.close.from.includes("delivered"));
  assert.deepEqual(TRANSITIONS.close.to, "operationally_closed");
});

test("lifecycle: you cannot skip a stage", () => {
  // can't release a trip that's only "approved" (must be assigned first)
  assert.ok(!TRANSITIONS.release.from.includes("approved"));
  // can't start a trip that isn't released
  assert.ok(!TRANSITIONS.start.from.includes("assigned"));
  // can't deliver a trip that hasn't started
  assert.ok(!TRANSITIONS.deliver.from.includes("released"));
  // can't close a trip that isn't delivered
  assert.ok(!TRANSITIONS.close.from.includes("in_transit"));
});

test("lifecycle: cancel is allowed pre-transit (and for rejected), never once moving", () => {
  const post = ["released", "in_transit", "delivered", "operationally_closed", "cancelled"];
  for (const s of post) {
    assert.ok(!TRANSITIONS.cancel.from.includes(s), `cancel must not be allowed from ${s}`);
  }
  assert.ok(TRANSITIONS.cancel.from.includes("approved"));
  // a rejected trip is a dead end — allow it to be discarded (cancelled)
  assert.ok(TRANSITIONS.cancel.from.includes("rejected"));
  assert.deepEqual(TRANSITIONS.cancel.to, "cancelled");
});

test("lifecycle: start & deliver stamp actual departure / arrival", () => {
  assert.match(TRANSITIONS.start.extraSet, /actual_departure/);
  assert.match(TRANSITIONS.deliver.extraSet, /actual_arrival/);
});
