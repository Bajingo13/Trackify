import { isProduction } from "./environment.js";

/**
 * Refuse to point development tooling at a production database.
 *
 * The test suite creates and deletes real companies, users and trips, and some
 * of the scripts are worse: db:reset-demo deletes trips, vouchers, invoices
 * and journal entries; db:seed-demo sets every role's account to the published
 * demonstration password, undoing a credential rotation; db:seed-admin resets
 * the administrator's password to a local value. Each of them uses whatever
 * database DB_* names.
 *
 * isProduction() is not enough on its own. The realistic way this goes wrong
 * is a developer copying production credentials into a local .env to run a
 * one-off command — rotating a PIN, say — and forgetting to put them back. That
 * .env sets no RAILWAY_ENVIRONMENT and probably says NODE_ENV=development, so
 * the process does not look like production. The database it points at does:
 * Railway's hosts and Railway's default database name are recognised here.
 *
 * A staging database on Railway would be refused too, which is the safe
 * default. ALLOW_WRITES_TO_THIS_DATABASE=yes overrides it, deliberately
 * spelled out so it cannot be set by accident.
 */

const RAILWAY_HOST = /(^|\.)(rlwy\.net|railway\.internal|railway\.app)$/i;

export function productionDatabaseReason(env = process.env) {
  if (env.ALLOW_WRITES_TO_THIS_DATABASE === "yes") return null;

  if (isProduction(env)) return "this process is configured as production";

  // The same precedence as config/db.js, so this checks the database that
  // would actually be written to.
  const host = String(env.DB_HOST || env.MYSQLHOST || "").trim();
  const name = String(env.DB_NAME || env.MYSQLDATABASE || "").trim();

  if (host && RAILWAY_HOST.test(host)) return `the database host ${host} is a Railway database`;
  if (name === "railway") return 'the database is named "railway", Railway\'s production default';
  return null;
}

/**
 * Stop before anything is written. Loud and non-zero on purpose: a test suite
 * that quietly skipped would look green.
 */
export function refuseProductionDatabase(purpose, { env = process.env, exit = process.exit, log = console.error } = {}) {
  const reason = productionDatabaseReason(env);
  if (!reason) return false;
  log(
    [
      "",
      `  REFUSING TO RUN ${purpose.toUpperCase()} — ${reason}.`,
      "",
      "  This writes to and deletes from the database it is pointed at. If the",
      "  local .env was pointed at production for a one-off command, put it back.",
      "",
      "  To run against a non-production database that only looks like this",
      "  (a staging database on Railway, say), set ALLOW_WRITES_TO_THIS_DATABASE=yes.",
      "",
    ].join("\n")
  );
  exit(1);
  return true;
}
