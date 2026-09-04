/**
 * 013 — Trip-assignment state fix.
 *
 * Bug: `trip_assignments.is_current` / `.status` were write-once — nothing ever
 * closed an assignment when its trip finished. The dispatch conflict check
 * ("Vehicle/Driver already has an active assignment") only looked at
 * `is_current = TRUE AND status IN ('assigned','accepted')`, so once a resource
 * completed one trip it could never be assigned again.
 *
 * Code fix (dispatch.controller.js + trip-status.service.js): the conflict
 * check now also requires the trip to still be running, and terminal trip
 * transitions close out the assignment.
 *
 * This migration clears the historical stale rows. Idempotent.
 */
export async function up(conn) {
  await conn.query(`
    UPDATE trip_assignments ta
    JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
    SET ta.is_current = FALSE,
        ta.status = CASE
          WHEN tt.status = 'cancelled' THEN 'cancelled'
          WHEN ta.status IN ('assigned','accepted','released') THEN 'completed'
          ELSE ta.status
        END
    WHERE ta.is_current = TRUE
      AND tt.status IN ('operationally_closed','cancelled','rejected','delivered','returned')
  `);
}
