/**
 * 014 — Repair trip_assignments.is_current after the model change.
 *
 * Migration 013 (and some manual cleanups) cleared `is_current` for every
 * assignment on a finished trip. The model is now:
 *   is_current = "the authoritative assignment for this trip" — it survives the
 *   trip ending and is only cleared when the trip is re-dispatched to someone
 *   else. "Free" is derived from the *trip* status, not this flag.
 *
 * This restores `is_current` on the latest assignment of any trip that lost it,
 * and normalises each current assignment's own `status` to match its trip.
 * Idempotent.
 */
export async function up(conn) {
  // 1. Trips that have assignments but no current one — flag the newest.
  await conn.query(`
    UPDATE trip_assignments ta
    JOIN (
      SELECT trip_ticket_id, MAX(assignment_id) AS keep_id
      FROM trip_assignments
      WHERE trip_ticket_id NOT IN (
        SELECT trip_ticket_id FROM (
          SELECT DISTINCT trip_ticket_id FROM trip_assignments WHERE is_current = TRUE
        ) x
      )
      GROUP BY trip_ticket_id
    ) pick ON pick.keep_id = ta.assignment_id
    SET ta.is_current = TRUE
  `);

  // 2. Line each current assignment's status up with its trip.
  await conn.query(`
    UPDATE trip_assignments ta
    JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
    SET ta.status = CASE
      WHEN tt.status = 'cancelled' THEN 'cancelled'
      WHEN tt.status IN ('delivered', 'returned', 'operationally_closed') THEN 'completed'
      WHEN tt.status IN ('released', 'in_transit') THEN 'released'
      WHEN tt.status IN ('assigned', 'accepted') THEN tt.status
      ELSE ta.status
    END
    WHERE ta.is_current = TRUE
  `);
}
