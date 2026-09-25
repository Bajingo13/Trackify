import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isProduction } from "./environment.js";

/**
 * One answer to "is this production?".
 *
 * Four places used to ask it by NODE_ENV alone while the demo-credential guard
 * also counted RAILWAY_ENVIRONMENT. A deployment that lost NODE_ENV would have
 * registered the route that clears the brute-force throttle, let localhost
 * through CORS, and stopped trusting Railway's proxy — so every visitor shared
 * one address in the sign-in throttle.
 */

test("Railway counts as production even without NODE_ENV", () => {
  assert.equal(isProduction({ RAILWAY_ENVIRONMENT: "production" }), true);
  assert.equal(isProduction({ NODE_ENV: "production" }), true);
});

test("a development machine and the test runner do not", () => {
  assert.equal(isProduction({ NODE_ENV: "development" }), false);
  assert.equal(isProduction({ NODE_ENV: "test" }), false);
  assert.equal(isProduction({}), false);
});

test("nothing decides production by NODE_ENV on its own any more", () => {
  /*
   * The regression this guards is a fifth check written the old way. Every
   * behaviour switch has to go through isProduction, or the two answers drift
   * apart again the next time an environment variable goes missing.
   */
  const files = [
    "src/app.js",
    "src/config/cors.js",
    "src/middleware/loginRateLimit.js",
    "src/modules/auth/auth.routes.js",
  ];
  for (const file of files) {
    const source = fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /NODE_ENV\s*(===|!==)\s*["']production["']/,
      `${file} decides production by NODE_ENV alone`
    );
    assert.match(source, /isProduction\(/, `${file} does not use isProduction`);
  }
});
