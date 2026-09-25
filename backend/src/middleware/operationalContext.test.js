import "../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../config/db.js";
import operationalContext from "./operationalContext.js";

test("an inactive company cannot be used as an operating context", async () => {
  const execute = db.execute;
  try {
    // The joined company/branch lookup returns no row when either side is
    // inactive. This must stop the request before access grants are examined.
    db.execute = async () => [[]];
    let nextCalled = false;
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };

    await operationalContext(
      {
        headers: { "x-company-id": "8", "x-branch-id": "12" },
        user: { userId: 3 },
      },
      res,
      () => { nextCalled = true; }
    );

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /inactive or unavailable/i);
    assert.equal(nextCalled, false);
  } finally {
    db.execute = execute;
  }
});
