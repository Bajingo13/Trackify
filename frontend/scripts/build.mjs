/**
 * `vite build`, always as a production build.
 *
 *   node scripts/build.mjs [any vite build arguments]
 *
 * The root .env sets NODE_ENV=development for the backend, and Vite applies a
 * NODE_ENV=development found in .env to the build — so every local build, and
 * every Driver App APK, came out as a development build: development React,
 * development JSX, larger and slower on a cheap phone, with every effect run
 * twice under StrictMode.
 *
 * Overriding React alone inside vite.config does not work, and was tried: the
 * JSX transform still followed .env and emitted jsxDEV calls, which production
 * React does not provide, and the app crashed on a blank screen. Vite only
 * ignores the .env value when NODE_ENV is already set when it starts, so this
 * sets it and then runs Vite. Railway sets NODE_ENV=production itself; there
 * this changes nothing.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
// The CLI is not in vite's exports map, so find it beside its package.json.
const vite = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");

const result = spawnSync(process.execPath, [vite, "build", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});
process.exit(result.status ?? 1);
