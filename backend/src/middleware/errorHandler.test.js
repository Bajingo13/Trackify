import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import multer from "multer";
import errorHandler from "./errorHandler.js";

/**
 * What the server says when something is refused.
 *
 * The fault these pin down only existed in production. The last branch of the
 * handler replaced every message with "Internal server error." whenever
 * NODE_ENV was not "development" — including the 4xx ones written for the
 * person who made the mistake. An audit run in development saw the good
 * messages; a driver in production uploading a PDF where a photo belonged was
 * told the server was broken. So every case here runs as production.
 */

let savedEnv;
let savedError;
beforeEach(() => {
  savedEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  // The handler logs every error; that is its job, not this test's output.
  savedError = console.error;
  console.error = () => {};
});
afterEach(() => {
  process.env.NODE_ENV = savedEnv;
  console.error = savedError;
});

function run(error) {
  const res = { statusCode: 0, body: null, headersSent: false };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  errorHandler(error, {}, res, () => {});
  return res;
}

test("a refused upload type keeps its message in production", () => {
  const err = Object.assign(new Error("Your photo must be a JPG, PNG, WebP or HEIC image."), { status: 400 });
  const res = run(err);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Your photo must be a JPG, PNG, WebP or HEIC image.");
});

test("any deliberate 4xx keeps its message in production", () => {
  const res = run(Object.assign(new Error("A vehicle type is required."), { status: 400 }));
  assert.equal(res.body.message, "A vehicle type is required.");
});

test("a 5xx is still masked in production", () => {
  // That is where a message could describe the server rather than the request.
  const res = run(new Error("ER_SOMETHING at /srv/app/db.js:42 with password=hunter2"));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "Internal server error.");
  assert.doesNotMatch(JSON.stringify(res.body), /hunter2|db\.js/);
});

test("an oversized file is 413, and says the limit it hit", () => {
  const err = new multer.MulterError("LIMIT_FILE_SIZE", "photo");
  err.maxBytes = 4 * 1024 * 1024;
  const res = run(err);
  assert.equal(res.statusCode, 413);
  assert.match(res.body.message, /too large/);
  assert.match(res.body.message, /4 MB/);
});

test("an oversized file with no known limit is still 413, never 500", () => {
  /*
   * The status matters more than the wording. The Driver App's offline queue
   * drops a 4xx and retries anything else in order, so a 500 here left a
   * photo that could never fit at the head of the queue for ever.
   */
  const res = run(new multer.MulterError("LIMIT_FILE_SIZE", "photo"));
  assert.equal(res.statusCode, 413);
  assert.ok(res.statusCode >= 400 && res.statusCode < 500);
});

test("other upload limits are 400 with a sentence, not multer's wording", () => {
  const res = run(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "attachment"));
  assert.equal(res.statusCode, 400);
  assert.doesNotMatch(res.body.message, /Unexpected field/);
});

test("malformed JSON is 400 with a readable reason", () => {
  const err = Object.assign(new SyntaxError("Unexpected token n in JSON at position 1"), {
    status: 400, type: "entity.parse.failed", expose: true,
  });
  const res = run(err);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /not valid JSON/);
});

test("an oversized request body is 413", () => {
  const err = Object.assign(new Error("request entity too large"), {
    status: 413, type: "entity.too.large", expose: true,
  });
  const res = run(err);
  assert.equal(res.statusCode, 413);
  assert.match(res.body.message, /too large/);
});

test("the duplicate-value and database-down answers are unchanged", () => {
  assert.equal(run(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" })).statusCode, 409);
  const down = run(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }));
  assert.equal(down.statusCode, 503);
  assert.equal(down.body.message, "Service temporarily unavailable.");
});

test("in development a 5xx still shows its message, for whoever is debugging", () => {
  process.env.NODE_ENV = "development";
  const res = run(new Error("something specific broke"));
  assert.equal(res.body.message, "something specific broke");
});
