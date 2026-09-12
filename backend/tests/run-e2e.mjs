/**
 * Runs the API end-to-end suites against a live backend.
 *
 *   npm --prefix backend run test:e2e
 *
 * These are not `node --test` files. Each is a standalone script that arranges
 * its own fixture against a seeded database, prints `ok` / `FAIL` lines, and
 * sets a non-zero exit code if anything failed — so this runner spawns them in
 * turn and reports which suites passed rather than which assertions did.
 *
 * A server must already be listening on TRACKIFY_API_URL (default :5000) with
 * demo data seeded; the runner refuses to start otherwise, because every suite
 * would then fail for the same uninteresting reason.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.TRACKIFY_API_URL || "http://localhost:5000";

/* login-throttle deliberately blocks an identity for fifteen minutes, so it
 * runs last even though it uses an account no other suite touches. */
const LAST = "login-throttle.e2e.mjs";

const suites = readdirSync(HERE)
  .filter((f) => f.endsWith(".e2e.mjs"))
  .sort((a, b) => (a === LAST) - (b === LAST) || a.localeCompare(b));

if (suites.length === 0) {
  console.error("no .e2e.mjs suites found in", HERE);
  process.exit(2);
}

async function waitForApi(attempts = 30) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(`${API}/api/health`);
      const body = await res.json();
      if (res.ok) {
        console.log(`API ready at ${API} (database: ${body.database})\n`);
        return;
      }
      console.log(`  attempt ${i}: HTTP ${res.status} (${body.status})`);
    } catch {
      console.log(`  attempt ${i}: not listening yet`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(
    `\nNo healthy backend at ${API} after ${attempts}s.\n` +
      `Start one with: npm --prefix backend run dev`,
  );
  process.exit(2);
}

function run(file) {
  return new Promise((resolve) => {
    console.log(`\n${"=".repeat(64)}\n  ${file}\n${"=".repeat(64)}`);
    const child = spawn(process.execPath, [path.join(HERE, file)], {
      stdio: "inherit",
      cwd: path.resolve(HERE, ".."),
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

await waitForApi();

const results = [];
for (const file of suites) {
  results.push([file, await run(file)]);
}

const failed = results.filter(([, code]) => code !== 0);

console.log(`\n${"=".repeat(64)}\n  Summary\n${"=".repeat(64)}`);
for (const [file, code] of results) {
  console.log(`  ${code === 0 ? "pass" : "FAIL"}  ${file}`);
}
console.log(
  `\n  ${results.length - failed.length}/${results.length} suites passed`,
);

if (suites.includes(LAST)) {
  console.log(
    `\n  Note: ${LAST} leaves an account rate-limited for fifteen minutes, and\n` +
      `  that state lives in the server's memory. Restart the backend before\n` +
      `  running this again, or the next run reports failures that are only the\n` +
      `  throttle talking.`,
  );
}

process.exit(failed.length ? 1 : 0);
