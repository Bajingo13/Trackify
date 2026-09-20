import db from "../../config/db.js";
import { haversineKm } from "./geo.service.js";
import { publish } from "../../realtime/hub.js";
import { recordAudit } from "../../shared/audit.js";

/**
 * Post-approval trip lifecycle transitions. The earlier gates
 * (submit / validate / approve / reject / assign) live in trips.controller
 * and dispatch.controller and are unchanged.
 *
 *   assigned ──release──▶ released ──start──▶ in_transit ──deliver──▶ delivered ──close──▶ operationally_closed
 *   (most pre-transit states) ──cancel──▶ cancelled
 */
export const TRANSITIONS = {
  release: {
    from: ["assigned", "accepted"],
    to: "released",
    action: "RELEASE_TRIP",
    verb: "release",
  },
  start: {
    from: ["released"],
    to: "in_transit",
    action: "START_TRANSIT",
    verb: "start",
    extraSet: "actual_departure = COALESCE(actual_departure, NOW())",
  },
  deliver: {
    from: ["in_transit"],
    to: "delivered",
    action: "CONFIRM_DELIVERY",
    verb: "confirm delivery for",
    extraSet: "actual_arrival = NOW()",
  },
  close: {
    from: ["delivered", "returned"],
    to: "operationally_closed",
    action: "CLOSE_TRIP",
    verb: "close",
  },
  cancel: {
    // pre-transit states, plus "rejected" so a dead trip can be discarded
    from: ["draft", "for_validation", "for_approval", "approved", "assigned", "accepted", "rejected"],
    to: "cancelled",
    action: "CANCEL_TRIP",
    verb: "cancel",
  },
};

/**
 * Run one transition inside a row lock + transaction, writing status history.
 * `remarks` is optional free text (POD note, cancellation reason, …).
 */
export async function runTransition(req, res, key, remarks = null) {
  const { companyId, branchId, userId } = req.context;
  const tripId = Number(req.params.id);
  const spec = TRANSITIONS[key];

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT trip_ticket_id, ticket_no, status, route_distance_km FROM trip_tickets
       WHERE trip_ticket_id = ? AND company_id = ? AND branch_id = ? FOR UPDATE`,
      [tripId, companyId, branchId]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: "Trip not found." });
    }

    const from = rows[0].status;
    if (!spec.from.includes(from)) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: `Trip is ${from.replace(/_/g, " ")} — you can't ${spec.verb} it at this stage.`,
      });
    }

    await conn.execute(
      `UPDATE trip_tickets SET status = ?${spec.extraSet ? `, ${spec.extraSet}` : ""} WHERE trip_ticket_id = ?`,
      [spec.to, tripId]
    );

    // Keep the assignment's own state in step with the trip. `is_current` is
    // NOT touched here — it means "the authoritative assignment for this trip"
    // and is only cleared when the trip is re-dispatched to someone else. What
    // makes a vehicle/driver "free" is the *trip* status (every busy-check also
    // filters `tt.status IN (assigned|accepted|released|in_transit)`), so a
    // completed/cancelled trip already frees them while the row stays visible
    // on the trip's Assignment tab and in the audit history.
    const assignmentStatus =
      spec.to === "cancelled" ? "cancelled"
      : ["delivered", "returned", "operationally_closed"].includes(spec.to) ? "completed"
      : spec.to === "released" ? "released"
      : null;
    if (assignmentStatus) {
      await conn.execute(
        `UPDATE trip_assignments
           SET status = ?
         WHERE trip_ticket_id = ? AND is_current = TRUE
           AND status NOT IN ('completed', 'cancelled')`,
        [assignmentStatus, tripId]
      );
    }

    // On close: add the trip's driven distance to the vehicle's odometer.
    // Prefer the actual GPS trail (summed), fall back to the routed distance.
    if (spec.to === "operationally_closed") {
      const [[asg]] = await conn.execute(
        `SELECT vehicle_id FROM trip_assignments WHERE trip_ticket_id = ? AND is_current = TRUE LIMIT 1`,
        [tripId]
      );
      if (asg?.vehicle_id) {
        const [pts] = await conn.execute(
          `SELECT latitude, longitude FROM trip_tracking_points
           WHERE trip_ticket_id = ? ORDER BY recorded_at ASC`,
          [tripId]
        );
        let km = 0;
        for (let i = 1; i < pts.length; i += 1) {
          km += haversineKm(
            { lat: Number(pts[i - 1].latitude), lng: Number(pts[i - 1].longitude) },
            { lat: Number(pts[i].latitude), lng: Number(pts[i].longitude) }
          );
        }
        if (km < 0.5) km = Number(rows[0].route_distance_km) || 0;
        km = Math.round(km * 10) / 10;
        if (km > 0) {
          await conn.execute(
            `UPDATE vehicles SET odometer = odometer + ? WHERE vehicle_id = ?`,
            [km, asg.vehicle_id]
          );
        }
      }
    }

    await conn.execute(
      `INSERT INTO trip_status_history
         (company_id, branch_id, trip_ticket_id, from_status, to_status, action, remarks, changed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, branchId, tripId, from, spec.to, spec.action, remarks, userId]
    );

    await conn.commit();

    /*
     * Audited here, where every post-approval transition passes through.
     *
     * The operations module wrote nothing to the audit log at all — the core
     * workflow of a system sold on BIR compliance was the one part with no
     * trail. trip_status_history records the change, but it is a table nobody
     * outside operations reads and it cannot answer "what did this person do
     * today" across the system. Both now hold it.
     *
     * After the commit on purpose: an audit row for a transition that was
     * rolled back would be a record of something that never happened.
     */
    await recordAudit(req, {
      module: "operations",
      action: `trip.${key}`,
      entityType: "trip_ticket",
      entityId: tripId,
      summary: `${spec.verb.replace(/^./, (c) => c.toUpperCase())} trip ${rows[0].ticket_no}`,
      metadata: { from, to: spec.to, remarks: remarks || null },
    });

    publish(companyId, branchId, {
      type: "trip:status",
      tripId,
      status: spec.to,
      from,
    });

    res.json({
      success: true,
      message: `Trip ${spec.to.replace(/_/g, " ")}.`,
      data: { status: spec.to },
    });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
