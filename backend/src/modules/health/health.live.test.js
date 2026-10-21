import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import healthRoutes from "./health.routes.js";

/*
 * The Driver App calls itself online again only after this answers, so it has
 * to answer without the database: a slow DB must not read as "no internet".
 */
test("GET /api/health/live answers 204, uncached, without touching the database", async () => {
  const app = express();
  app.use("/api/health", healthRoutes);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const r = await fetch(`http://127.0.0.1:${port}/api/health/live`);
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("cache-control"), "no-store");
  } finally {
    server.close();
  }
});
