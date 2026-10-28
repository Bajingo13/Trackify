/**
 * Driver reports as operational exceptions.
 *
 * The office already works from one panel for things that interrupt a delivery,
 * so what a driver reports lands there rather than in a second place to watch:
 * every pause request, and every concern a driver files about a trip, a truck
 * or safety. Each is one exception, linked to where it came from
 * (source_kind, source_id), and the two keep each other's status:
 *
 *   pause pending   ───────────────▶ exception open
 *   pause approved  ───────────────▶ exception acknowledged (the delivery is paused)
 *   pause resumed / declined / withdrawn ─▶ exception resolved, with what happened
 *
 *   request open ───▶ open · in progress ───▶ acknowledged · resolved or closed ───▶ resolved
 *
 * These only ever write the exception. The workflow that owns the source — the
 * pause, the request — decides, and tells the exception afterwards, so there is
 * one direction of authority and no loop.
 *
 * `runner` is a pool or a connection: the caller's transaction is respected.
 */

/** Requests in these categories can interrupt a delivery, so they are exceptions too. */
export const EXCEPTION_CATEGORIES = new Set(["vehicle", "safety", "trip"]);

const PAUSE_TYPE = {
  breakdown: "vehicle_breakdown",
  emergency: "driver_emergency",
  incident: "driver_incident",
  delay: "trip_delay",
  other: "driver_concern",
};
const PAUSE_SEVERITY = { emergency: "critical", incident: "critical", breakdown: "warning", delay: "warning", other: "info" };

/** A driver's pause request, raised as an exception. Idempotent per pause. */
export async function openForPause(runner, {
  companyId, branchId, tripId, pauseId, reason, reasonLabel, driverName, description, latitude = null, longitude = null,
}) {
  await runner.execute(
    `INSERT INTO operational_exceptions
       (company_id, branch_id, trip_ticket_id, source_kind, source_id, exception_type, severity,
        title, description, latitude, longitude)
     VALUES (?, ?, ?, 'pause', ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE exception_id = exception_id`,
    [
      companyId, branchId, tripId, pauseId, PAUSE_TYPE[reason] || "driver_concern", PAUSE_SEVERITY[reason] || "warning",
      `Pause request: ${reasonLabel}`.slice(0, 200),
      `${driverName}: ${description}`.slice(0, 4000),
      latitude, longitude,
    ]
  );
}

/** A concern a driver filed in Help & Support that touches the delivery. Idempotent per request. */
export async function openForTicket(runner, {
  companyId, branchId, tripId = null, ticketId, category, priority, driverName, subject, body,
}) {
  const severity = category === "safety" || priority === "urgent" ? "critical" : "warning";
  await runner.execute(
    `INSERT INTO operational_exceptions
       (company_id, branch_id, trip_ticket_id, source_kind, source_id, exception_type, severity, title, description)
     VALUES (?, ?, ?, 'support', ?, 'driver_concern', ?, ?, ?)
     ON DUPLICATE KEY UPDATE exception_id = exception_id`,
    [
      companyId, branchId, tripId, ticketId, severity,
      `Driver report: ${subject}`.slice(0, 200),
      `${driverName}: ${body}`.slice(0, 4000),
    ]
  );
}

/**
 * A pre-trip inspection that found something wrong. A critical item (brakes,
 * tyres, lights) holds the trip until Fleet approves departure, so it is
 * critical here too; anything else is a warning for Fleet to look at.
 * Idempotent per inspection.
 */
export async function openForInspection(runner, {
  companyId, branchId, tripId, inspectionId, critical, problems, driverName, plateNo = null,
  latitude = null, longitude = null,
}) {
  const what = problems.map((p) => p.label).join(", ");
  await runner.execute(
    `INSERT INTO operational_exceptions
       (company_id, branch_id, trip_ticket_id, source_kind, source_id, exception_type, severity,
        title, description, latitude, longitude)
     VALUES (?, ?, ?, 'inspection', ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE exception_id = exception_id`,
    [
      companyId, branchId, tripId, inspectionId,
      critical ? "vehicle_inspection_failed" : "vehicle_inspection_issue",
      critical ? "critical" : "warning",
      `${critical ? "Pre-trip inspection failed" : "Pre-trip inspection issue"}${plateNo ? ` (${plateNo})` : ""}: ${what}`.slice(0, 200),
      [
        `${driverName} reported:`,
        ...problems.map((p) => `• ${p.label}${p.critical ? " (critical)" : ""}: ${p.note}`),
        critical ? "The trip cannot start until Fleet approves departure." : "The trip may start.",
      ].join("\n").slice(0, 4000),
      latitude, longitude,
    ]
  );
}

/*
 * A delivery that did not go as planned. Not delivered is a failed delivery
 * and critical: a load is still on the truck and the office has to decide what
 * happens to it. Short or damaged on a delivery that went through is a warning.
 */
const DELIVERY_REPORT_TYPE = {
  short: "cargo_shortage",
  damaged: "cargo_damage",
  wrong_item: "cargo_damage",
};

/** A driver's delivery report, raised as an exception. Idempotent per report. */
export async function openForDeliveryReport(runner, {
  companyId, branchId, tripId, reportId, outcome, reason, reasonLabel, note, driverName,
  qtyExpected = null, qtyDelivered = null, latitude = null, longitude = null,
}) {
  const failed = outcome === "not_delivered";
  const qty = qtyExpected != null && qtyDelivered != null ? ` (${qtyDelivered} of ${qtyExpected} delivered)` : "";
  await runner.execute(
    `INSERT INTO operational_exceptions
       (company_id, branch_id, trip_ticket_id, source_kind, source_id, exception_type, severity,
        title, description, latitude, longitude)
     VALUES (?, ?, ?, 'delivery_report', ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE exception_id = exception_id`,
    [
      companyId, branchId, tripId, reportId,
      failed ? "failed_delivery" : DELIVERY_REPORT_TYPE[reason] || "cargo_damage",
      failed ? "critical" : "warning",
      `${failed ? "Not delivered" : "Delivered with a problem"}: ${reasonLabel}${qty}`.slice(0, 200),
      [
        `${driverName}: ${note}`,
        failed
          ? "The load is still on the truck. The trip stays on the road until the office decides: reattempt, return or resolve."
          : "The delivery was recorded with its proof of delivery.",
      ].join("\n").slice(0, 4000),
      latitude, longitude,
    ]
  );
}

/** A delivery report has been dealt with — by the office, or by a later delivery. */
export async function settleForDeliveryReport(runner, reportId, { userId = null, note = null }) {
  await runner.execute(
    `UPDATE operational_exceptions
        SET status = 'resolved', resolved_by = ?, resolved_at = NOW(),
            acknowledged_at = COALESCE(acknowledged_at, NOW()), resolution_notes = ?
      WHERE source_kind = 'delivery_report' AND source_id = ? AND status <> 'resolved'`,
    [userId, String(note || "").slice(0, 2000) || null, reportId]
  );
}

/** Fleet has dealt with an inspection — approved departure, or reviewed it. */
export async function settleForInspection(runner, inspectionId, { userId = null, note = null }) {
  await runner.execute(
    `UPDATE operational_exceptions
        SET status = 'resolved', resolved_by = ?, resolved_at = NOW(),
            acknowledged_at = COALESCE(acknowledged_at, NOW()), resolution_notes = ?
      WHERE source_kind = 'inspection' AND source_id = ? AND status <> 'resolved'`,
    [userId, String(note || "").slice(0, 2000) || null, inspectionId]
  );
}

/** Follow a pause: approved means acknowledged; anything that ends it means resolved. */
export async function settleForPause(runner, pauseId, { status, userId = null, note = null }) {
  if (status === "approved") {
    await runner.execute(
      `UPDATE operational_exceptions
          SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = COALESCE(acknowledged_at, NOW())
        WHERE source_kind = 'pause' AND source_id = ? AND status = 'open'`,
      [userId, pauseId]
    );
    return;
  }
  if (status === "declined" || status === "resumed" || status === "cancelled") {
    await runner.execute(
      `UPDATE operational_exceptions
          SET status = 'resolved', resolved_by = ?, resolved_at = NOW(),
              acknowledged_at = COALESCE(acknowledged_at, NOW()), resolution_notes = ?
        WHERE source_kind = 'pause' AND source_id = ? AND status <> 'resolved'`,
      [userId, String(note || "").slice(0, 2000) || null, pauseId]
    );
  }
}

/** Follow a request's status. Only exceptions that came from a request are touched. */
export async function settleForTicket(runner, ticketId, status, { userId = null, note = null } = {}) {
  if (status === "in_progress") {
    await runner.execute(
      `UPDATE operational_exceptions
          SET status = 'acknowledged', acknowledged_by = COALESCE(acknowledged_by, ?), acknowledged_at = COALESCE(acknowledged_at, NOW())
        WHERE source_kind = 'support' AND source_id = ? AND status = 'open'`,
      [userId, ticketId]
    );
  } else if (status === "resolved" || status === "closed") {
    await runner.execute(
      `UPDATE operational_exceptions
          SET status = 'resolved', resolved_by = ?, resolved_at = NOW(),
              acknowledged_at = COALESCE(acknowledged_at, NOW()), resolution_notes = ?
        WHERE source_kind = 'support' AND source_id = ? AND status <> 'resolved'`,
      [userId, String(note || "").slice(0, 2000) || (status === "closed" ? "Request closed." : "Request resolved."), ticketId]
    );
  } else if (status === "open") {
    // a driver wrote back to a request marked resolved: it is open again
    await runner.execute(
      `UPDATE operational_exceptions
          SET status = 'open', resolved_by = NULL, resolved_at = NULL, resolution_notes = NULL
        WHERE source_kind = 'support' AND source_id = ? AND status = 'resolved'`,
      [ticketId]
    );
  }
}
