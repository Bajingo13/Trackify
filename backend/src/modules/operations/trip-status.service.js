import db from "../../config/db.js";

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
    from: ["draft", "for_validation", "for_approval", "approved", "assigned", "accepted"],
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
      `SELECT trip_ticket_id, status FROM trip_tickets
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

    await conn.execute(
      `INSERT INTO trip_status_history
         (company_id, branch_id, trip_ticket_id, from_status, to_status, action, remarks, changed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, branchId, tripId, from, spec.to, spec.action, remarks, userId]
    );

    await conn.commit();
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
