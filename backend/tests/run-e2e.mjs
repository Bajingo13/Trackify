/**
 * Runs the API end-to-end suites against a live backend.
 *
 *   npm --prefix backend run test:e2e
 *
 * These are not `node --test` files. Each is a standalone script that arranges
 * its own fixture against a seeded database, prints `ok` / `FAIL` lines, and
 * signals its result through the exit code:
 *
 *   0  every assertion passed
 *   1  an assertion failed — a real result, worth blocking on
 *   2  the fixture it needs is not in the database, so it never ran
 *
 * The difference between 1 and 2 matters. A suite that cannot find an
 * in-transit trip has not found a bug; it has found a database that does not
 * look like the one it was written against. Reporting both as "failed" is how
 * you end up ignoring the suite.
 *
 * A server must already be listening on TRACKIFY_API_URL (default :5000) with
 * demo data seeded; the runner refuses to start otherwise, because every suite
 * would then fail for the same uninteresting reason.
 *
 * Under GitHub Actions it also emits ::error:: / ::warning:: annotations, so a
 * failure is readable from the run summary without digging through the log.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.TRACKIFY_API_URL || "http://localhost:5000";
const CI = Boolean(process.env.GITHUB_ACTIONS);

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

/** GitHub Actions workflow command; a no-op anywhere else. */
function annotate(level, file, title, message) {
  if (!CI) return;
  const clean = String(message).replace(/\r?\n/g, "%0A").slice(0, 3500);
  console.log(
    `::${level} file=backend/tests/${file},title=${title}::${clean}`,
  );
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
  const message = `No healthy backend at ${API} after ${attempts}s. Start one with: npm --prefix backend run dev`;
  console.error(`\n${message}`);
  annotate("error", "run-e2e.mjs", "No backend to test against", message);
  process.exit(2);
}

/** Runs one suite, echoing its output live and keeping a copy to summarise. */
function run(file) {
  return new Promise((resolve) => {
    console.log(`\n${"=".repeat(64)}\n  ${file}\n${"=".repeat(64)}`);
    const child = spawn(process.execPath, [path.join(HERE, file)], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: path.resolve(HERE, ".."),
    });
    let output = "";
    for (const [stream, sink] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        output += chunk;
        sink.write(chunk);
      });
    }
    child.on("error", (err) => {
      output += `\n${err.message}`;
      resolve({ file, code: 1, output });
    });
    child.on("close", (code) => resolve({ file, code: code ?? 1, output }));
  });
}

await waitForApi();

const results = [];
for (const file of suites) {
  results.push(await run(file));
}

/* ---- classify ---- */
const passed = results.filter((r) => r.code === 0);
const unmet = results.filter((r) => r.code === 2);
const failed = results.filter((r) => r.code !== 0 && r.code !== 2);

for (const r of failed) {
  const lines = r.output
    .split(/\r?\n/)
    .filter((l) => l.trimStart().startsWith("FAIL"))
    .map((l) => l.trim());
  const detail = lines.length
    ? lines.join("\n")
    : r.output.split(/\r?\n/).filter(Boolean).slice(-6).join("\n");
  annotate("error", r.file, `${r.file} failed`, detail);
}

for (const r of unmet) {
  const why =
    r.output
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() || "fixture missing";
  annotate(
    "warning",
    r.file,
    `${r.file} could not run`,
    `${why}\nThe suite never executed — the database does not hold the fixture it expects.`,
  );
}

/* ---- summary ---- */
console.log(`\n${"=".repeat(64)}\n  Summary\n${"=".repeat(64)}`);
for (const r of results) {
  const verdict =
    r.code === 0 ? "pass" : r.code === 2 ? "SKIP" : "FAIL";
  console.log(`  ${verdict}  ${r.file}`);
}

console.log(
  `\n  ${passed.length}/${results.length} suites passed` +
    (unmet.length ? `, ${unmet.length} could not run` : "") +
    (failed.length ? `, ${failed.length} failed` : ""),
);

if (unmet.length) {
  console.log(
    `\n  Could not run:\n` +
      unmet
        .map(
          (r) =>
            `    ${r.file} — ${
              r.output
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean)
                .pop() || "fixture missing"
            }`,
        )
        .join("\n") +
      `\n  These need a database seeded the way they expect, not a code change.`,
  );
}

if (suites.includes(LAST)) {
  console.log(
    `\n  Note: ${LAST} leaves an account rate-limited for fifteen minutes, and\n` +
      `  that state lives in the server's memory. Restart the backend before\n` +
      `  running this again, or the next run reports failures that are only the\n` +
      `  throttle talking.`,
  );
}

process.exit(failed.length || unmet.length ? 1 : 0);
