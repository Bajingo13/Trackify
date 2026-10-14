import db from "../config/db.js";

/**
 * Close a driver's request once it has been resolved for a week with nobody
 * writing on it.
 *
 * "Resolved" still lets the driver write back (that reopens it); "closed" does
 * not. A request left resolved for ever would sit in the driver's History
 * looking as if it might still be answered, and in the office's list as
 * something that might still need them. After a week of quiet it is finished.
 *
 * Only requests that are resolved, and untouched since: any new message from the
 * driver or the office updates the ticket, so a conversation that is still going
 * is never closed under the people in it. A request holding a pause is never
 * resolved while the pause is live, so none of those can reach here early.
 */
export const AUTO_CLOSE_DAYS = 7;

export async function closeStaleResolved({ days = AUTO_CLOSE_DAYS, runner = db } = {}) {
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`The number of days must be a positive whole number, got ${days}`);
  }
  // Interpolated, not bound: MySQL takes no placeholder inside INTERVAL, and
  // this is an integer validated just above.
  const [result] = await runner.execute(
    `UPDATE support_tickets
        SET status = 'closed'
      WHERE status = 'resolved'
        AND resolved_at IS NOT NULL
        AND resolved_at < DATE_SUB(NOW(), INTERVAL ${days} DAY)
        AND updated_at < DATE_SUB(NOW(), INTERVAL ${days} DAY)`
  );
  return { closed: result.affectedRows, days };
}

/** At startup and then every hour. Never fatal, never holds the process open. */
export function scheduleSupportAutoClose({
  intervalMs = 60 * 60 * 1000,
  log = console,
  close = closeStaleResolved,
} = {}) {
  const run = async () => {
    try {
      const { closed } = await close();
      if (closed > 0) log.log(`[support] Closed ${closed} resolved request(s) that had been quiet for ${AUTO_CLOSE_DAYS} days`);
    } catch (error) {
      log.error(`[support] Could not close old resolved requests: ${error.message}`);
    }
  };
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
