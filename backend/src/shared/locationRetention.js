import db from "../config/db.js";
import { normaliseRetention } from "./companySettings.js";

/**
 * Delete the location trail once it has outlived its purpose.
 *
 * The privacy policy states that the stream of positions recorded while a trip
 * was running is kept for twelve months and then deleted. Nothing deleted it.
 * A retention promise that no code keeps is worse than no promise: it is a
 * commitment to a regulator, and to every driver, that the system quietly does
 * not honour.
 *
 * The trip record is a different thing and is untouched here. Where a load
 * went, when, who drove it and the proof of delivery are accounting records
 * kept for ten years. What goes is the minute-by-minute trail underneath —
 * which is the part that is a record of a person's movements rather than a
 * record of a delivery, and the part the Data Privacy Act asks us not to keep
 * longer than we need.
 *
 * So the delivery stays provable long after the driver's movements are gone,
 * which is the intended result rather than a compromise.
 */

/** Twelve months, matching the policy. Overridable for an operator with a different one. */
export const RETENTION_MONTHS = (() => {
  const raw = Number(process.env.LOCATION_TRAIL_MONTHS);
  return Number.isInteger(raw) && raw > 0 ? raw : 12;
})();

/* Deleted in batches. A year of points across a fleet is a large number of
 * rows, and one unbounded DELETE would hold locks long enough to stall
 * dispatch while it ran. */
const BATCH = 5000;

/**
 * Remove tracking points older than the retention period.
 *
 * `dryRun` reports what would go without touching anything, which is how this
 * should be looked at the first time on a real database.
 *
 * `companyIds` limits the sweep to those companies; `exceptCompanyIds` sweeps
 * everyone else. That is what lets one company keep its trail for eighteen
 * months without extending anybody else's.
 */
export async function pruneLocationTrail({
  months = RETENTION_MONTHS,
  runner = db,
  dryRun = false,
  batch = BATCH,
  companyIds = null,
  exceptCompanyIds = null,
} = {}) {
  if (!Number.isInteger(months) || months <= 0) {
    throw new Error(`Retention period must be a positive whole number of months, got ${months}`);
  }

  // Interpolated rather than bound: MySQL will not take a placeholder inside an
  // INTERVAL, and this is an integer this module has just validated itself.
  let where = `recorded_at < DATE_SUB(NOW(), INTERVAL ${months} MONTH)`;
  const params = [];

  const scope = (ids, negate) => {
    const list = (ids || []).map(Number).filter(Number.isInteger);
    if (!list.length) return;
    where += ` AND company_id ${negate ? "NOT IN" : "IN"} (${list.map(() => "?").join(",")})`;
    params.push(...list);
  };
  if (companyIds) {
    scope(companyIds, false);
    // An explicit but empty company list means "these companies", of which
    // there are none. Sweeping the whole table instead would be the opposite.
    if (!params.length) return { eligible: 0, deleted: 0, months };
  }
  scope(exceptCompanyIds, true);

  const [[{ eligible }]] = await runner.execute(
    `SELECT COUNT(*) AS eligible FROM trip_tracking_points WHERE ${where}`,
    params
  );

  if (dryRun || Number(eligible) === 0) return { eligible: Number(eligible), deleted: 0, months };

  let deleted = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const [result] = await runner.execute(
      `DELETE FROM trip_tracking_points WHERE ${where} LIMIT ${batch}`,
      params
    );
    deleted += result.affectedRows;
    if (result.affectedRows < batch) break;
  }

  return { eligible: Number(eligible), deleted, months };
}

/**
 * What each company has asked for, as a list of sweeps to run.
 *
 * A company that has never opened the settings screen is not in the settings
 * table at all, and is swept on the default period — so the policy applies to
 * everybody from the day this ships, and choosing a different one is an
 * explicit act by somebody who can be named in the audit log.
 */
export async function retentionPlan(runner = db) {
  const [rows] = await runner.execute(
    "SELECT company_id, location_retention_months AS months FROM company_settings"
  );

  const byPeriod = new Map();
  const configured = [];
  for (const row of rows) {
    const months = normaliseRetention(row.months) || RETENTION_MONTHS;
    configured.push(Number(row.company_id));
    if (!byPeriod.has(months)) byPeriod.set(months, []);
    byPeriod.get(months).push(Number(row.company_id));
  }

  const plan = [...byPeriod].map(([months, companyIds]) => ({ months, companyIds }));
  /* Everybody who has not chosen, swept last so the named companies are
   * already excluded from it. */
  plan.push({ months: RETENTION_MONTHS, exceptCompanyIds: configured });
  return plan;
}

/** Run every sweep the plan calls for and report the lot. */
export async function pruneByCompanyPolicy({ runner = db, dryRun = false, batch = BATCH } = {}) {
  const sweeps = [];
  let deleted = 0;
  let eligible = 0;

  for (const sweep of await retentionPlan(runner)) {
    // eslint-disable-next-line no-await-in-loop
    const result = await pruneLocationTrail({ ...sweep, runner, dryRun, batch });
    sweeps.push({ ...sweep, ...result });
    deleted += result.deleted;
    eligible += result.eligible;
  }

  return { eligible, deleted, sweeps };
}

/**
 * Keep the promise without anybody remembering to.
 *
 * A retention policy that depends on somebody running a command is a policy
 * until the first busy week. This runs once at startup and daily thereafter.
 *
 * The timer is unref'd so it never holds the process open — a scheduled job
 * that stops a server from shutting down is a worse problem than the one it
 * solves, and a hang reports nothing at all.
 */
export function scheduleLocationRetention({
  intervalMs = 24 * 60 * 60 * 1000,
  log = console,
  prune = pruneByCompanyPolicy,
} = {}) {
  const run = async () => {
    try {
      const result = await prune();
      if (result.deleted > 0) {
        const periods = result.sweeps
          ? [...new Set(result.sweeps.filter((s) => s.deleted > 0).map((s) => s.months))].join(", ")
          : result.months;
        log.log(
          `[retention] Removed ${result.deleted} location point(s) past the retention period (${periods} months)`
        );
      }
    } catch (error) {
      // Never fatal. Failing to prune is a problem to fix, not a reason to
      // take down a system that is otherwise serving trips.
      log.error(`[retention] Could not prune the location trail: ${error.message}`);
    }
  };

  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
