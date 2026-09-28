import db from "../config/db.js";
import { retentionPlan } from "./locationRetention.js";

/**
 * Delete trip chat once it has outlived its purpose.
 *
 * A driver's messages are personal data under the Data Privacy Act, and often
 * say where the driver is ("nasa gate na po"). They are kept while they can
 * settle a question about a delivery and then deleted — on the same period
 * each company already chose for its location trail, because the two are the
 * same kind of record: what a person said and where they were, around a run.
 *
 * Only closed or cancelled trips. A conversation is never cut out from under a
 * trip that is still running, however old its first message.
 *
 * The trip itself and its proof of delivery are untouched: they are accounting
 * records with their own, longer life.
 */

const CLOSED = "('operationally_closed','cancelled')";
const BATCH = 2000;

export async function pruneTripChat({
  months,
  runner = db,
  dryRun = false,
  batch = BATCH,
  companyIds = null,
  exceptCompanyIds = null,
} = {}) {
  if (!Number.isInteger(months) || months <= 0) {
    throw new Error(`Retention period must be a positive whole number of months, got ${months}`);
  }

  // Interpolated, not bound: MySQL takes no placeholder inside INTERVAL, and
  // this is an integer validated just above.
  let where = `m.created_at < DATE_SUB(NOW(), INTERVAL ${months} MONTH) AND tt.status IN ${CLOSED}`;
  const params = [];
  const scope = (ids, negate) => {
    const list = (ids || []).map(Number).filter(Number.isInteger);
    if (!list.length) return false;
    where += ` AND m.company_id ${negate ? "NOT IN" : "IN"} (${list.map(() => "?").join(",")})`;
    params.push(...list);
    return true;
  };
  // An explicit but empty list means "these companies", of which there are
  // none — never "everybody".
  if (companyIds && !scope(companyIds, false)) return { eligible: 0, deleted: 0, months };
  scope(exceptCompanyIds, true);

  const from = "FROM trip_messages m JOIN trip_tickets tt ON tt.trip_ticket_id = m.trip_ticket_id";
  const [[{ eligible }]] = await runner.execute(`SELECT COUNT(*) AS eligible ${from} WHERE ${where}`, params);
  if (dryRun || Number(eligible) === 0) return { eligible: Number(eligible), deleted: 0, months };

  let deleted = 0;
  for (;;) {
    // MySQL allows no LIMIT on a multi-table DELETE, so the ids are chosen
    // first, through a derived table it will accept in the same statement.
    // eslint-disable-next-line no-await-in-loop
    const [result] = await runner.execute(
      `DELETE FROM trip_messages WHERE message_id IN (
         SELECT message_id FROM (SELECT m.message_id ${from} WHERE ${where} LIMIT ${batch}) AS doomed
       )`,
      params
    );
    deleted += result.affectedRows;
    if (result.affectedRows < batch) break;
  }

  // Read markers for conversations that no longer have anything in them.
  await runner.execute(
    `DELETE r FROM trip_message_reads r
      LEFT JOIN trip_messages m ON m.trip_ticket_id = r.trip_ticket_id
      WHERE m.message_id IS NULL`
  );

  return { eligible: Number(eligible), deleted, months };
}

/** Each company on its own chosen period — the same plan the location trail uses. */
export async function pruneChatByCompanyPolicy({ runner = db, dryRun = false, batch = BATCH } = {}) {
  let deleted = 0;
  let eligible = 0;
  const sweeps = [];
  for (const sweep of await retentionPlan(runner)) {
    // eslint-disable-next-line no-await-in-loop
    const result = await pruneTripChat({ ...sweep, runner, dryRun, batch });
    sweeps.push({ ...sweep, ...result });
    deleted += result.deleted;
    eligible += result.eligible;
  }
  return { eligible, deleted, sweeps };
}

/** At startup and daily, like the location trail. Never fatal, never holds the process open. */
export function scheduleChatRetention({
  intervalMs = 24 * 60 * 60 * 1000,
  log = console,
  prune = pruneChatByCompanyPolicy,
} = {}) {
  const run = async () => {
    try {
      const result = await prune();
      if (result.deleted > 0) log.log(`[retention] Removed ${result.deleted} chat message(s) from closed trips past the retention period`);
    } catch (error) {
      log.error(`[retention] Could not prune trip chat: ${error.message}`);
    }
  };
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
