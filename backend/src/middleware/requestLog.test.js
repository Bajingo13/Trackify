import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pathOnly, REQUEST_LOG_FORMAT } from "./requestLog.js";

/*
 * The request log must never carry what somebody typed into a search box.
 */

test("the logged path drops the query string", () => {
  assert.equal(pathOnly({ originalUrl: "/api/v1/customers?search=juan%40example.com" }), "/api/v1/customers");
  assert.equal(pathOnly({ url: "/api/v1/operations/trips?status=released&search=ABC%201234" }), "/api/v1/operations/trips");
  assert.equal(pathOnly({ originalUrl: "/api/health" }), "/api/health");
  assert.equal(pathOnly({}), "");
});

test("the format uses that path, never the full URL", () => {
  assert.match(REQUEST_LOG_FORMAT, /:path-only/);
  assert.doesNotMatch(REQUEST_LOG_FORMAT, /:url\b/);
});

test("the app logs through it rather than morgan's full-URL formats", () => {
  const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /app\.use\(requestLog\(\)\)/);
  assert.doesNotMatch(app, /morgan\(/);
});
