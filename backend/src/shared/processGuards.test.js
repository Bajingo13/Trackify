import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { installProcessGuards } from "./processGuards.js";

function setup() {
  const target = new EventEmitter();
  const lines = [];
  const exits = [];
  const remove = installProcessGuards({ target, log: (l) => lines.push(l), exit: (c) => exits.push(c) });
  return { target, lines, exits, remove };
}

test("an unhandled rejection is logged and the process carries on", () => {
  const { target, lines, exits } = setup();
  target.emit("unhandledRejection", new Error("background job failed"));
  assert.equal(exits.length, 0);
  assert.match(lines[0], /unhandled rejection — continuing/);
  assert.match(lines[0], /background job failed/);
});

test("an uncaught exception is logged and the process exits non-zero", () => {
  const { target, lines, exits } = setup();
  target.emit("uncaughtException", new TypeError("boom"));
  assert.deepEqual(exits, [1]);
  assert.match(lines[0], /uncaught exception — exiting/);
});

test("quoted text in an error — an email, a plate number — never reaches the log", () => {
  const { target, lines } = setup();
  const error = new Error("Duplicate entry 'juan@example.com' for key 'uq_email'");
  error.code = "ER_DUP_ENTRY";
  error.stack = `Error: ${error.message}\n    at somewhere`;
  target.emit("unhandledRejection", error);
  assert.ok(!lines[0].includes("juan@example.com"));
  assert.match(lines[0], /ER_DUP_ENTRY/);
});

test("a rejection with something other than an Error is still described, not thrown on", () => {
  const { target, lines } = setup();
  for (const reason of ["just a string", undefined, null, { code: 7 }, 42]) {
    assert.doesNotThrow(() => target.emit("unhandledRejection", reason));
  }
  assert.equal(lines.length, 5);
});

test("the guards can be removed", () => {
  const { target, remove } = setup();
  remove();
  assert.equal(target.listenerCount("unhandledRejection"), 0);
  assert.equal(target.listenerCount("uncaughtException"), 0);
});
