import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { publish } from "../../realtime/hub.js";

const NUM = (v) => (v === "" || v == null ? null : Number(v));
const STR = (v) => (v === "" || v == null ? null : String(v).trim());

const TRIP_SELECT = `
  tt.trip_ticket_id, tt.ticket_no, tt.origin, tt.destination, tt.status,
  tt.cargo_description, tt.cargo_quantity, tt.cargo_weight, tt.special_handling,
  tt.scheduled_departure,
  c.customer_name,
  CONCAT(d.first_name, ' ', d.last_name) AS driver_name,
  v.plate_no
`;
const TRIP_JOINS = `
  LEFT JOIN customers c ON c.customer_id = tt.customer_id
  LEFT JOIN trip_assignments ta ON ta.trip_ticket_id = tt.trip_ticket_id AND ta.is_current = TRUE
  LEFT JOIN drivers d ON d.driver_id = ta.driver_id
  LEFT JOIN vehicles v ON v.vehicle_id = ta.vehicle_id
`;

function mapTrip(r) {
  return {
    tripTicketId: r.trip_ticket_id,
    ticketNo: r.ticket_no,
    route: `${r.origin} → ${r.destination}`,
    origin: r.origin,
    destination: r.destination,
    status: r.status,
    customer: r.customer_name || "—",
    driver: r.driver_name?.trim() || null,
    vehicle: r.plate_no || null,
    cargoDescription: r.cargo_description || "—",
    cargoQuantity: r.cargo_quantity == null ? null : Number(r.cargo_quantity),
    cargoWeight: r.cargo_weight == null ? null : Number(r.cargo_weight),
    specialHandling: r.special_handling || null,
    scheduledDeparture: r.scheduled_departure,
  };
}

/* GET /warehouse/cargo/queue?type=release|return */
export async function cargoQueue(req, res) {
  const { companyId, branchId } = req.context;
  const type = req.query.type === "return" ? "return" : "release";

  let where;
  if (type === "release") {
    // dispatched trips whose cargo hasn't been handed over yet
    where = `tt.status IN ('assigned','accepted','released')
             AND NOT EXISTS (SELECT 1 FROM cargo_events ce
               WHERE ce.trip_ticket_id = tt.trip_ticket_id AND ce.event_type = 'release')`;
  } else {
    // trips whose cargo was released but the trip ended without a clean full delivery
    where = `tt.status IN ('cancelled','delivered','operationally_closed','rejected')
             AND EXISTS (SELECT 1 FROM cargo_events ce
               WHERE ce.trip_ticket_id = tt.trip_ticket_id AND ce.event_type = 'release')
             AND NOT EXISTS (SELECT 1 FROM cargo_events ce
               WHERE ce.trip_ticket_id = tt.trip_ticket_id AND ce.event_type = 'return')`;
  }

  const [rows] = await db.execute(
    `SELECT ${TRIP_SELECT} FROM trip_tickets tt ${TRIP_JOINS}
     WHERE tt.company_id = ? AND tt.branch_id = ? AND ${where}
     ORDER BY tt.scheduled_departure ASC`,
    [companyId, branchId]
  );
  res.json({ success: true, data: rows.map(mapTrip) });
}

/* GET /warehouse/cargo/events */
export async function cargoEvents(req, res) {
  const { companyId, branchId } = req.context;
  const [rows] = await db.execute(
    `SELECT ce.*, tt.ticket_no, tt.origin, tt.destination,
            CONCAT(u.first_name, ' ', u.last_name) AS handled_by_name
     FROM cargo_events ce
     JOIN trip_tickets tt ON tt.trip_ticket_id = ce.trip_ticket_id
     LEFT JOIN users u ON u.user_id = ce.handled_by
     WHERE ce.company_id = ? AND (ce.branch_id = ? OR ce.branch_id IS NULL)
     ORDER BY ce.created_at DESC, ce.cargo_event_id DESC`,
    [companyId, branchId]
  );
  res.json({
    success: true,
    data: rows.map((r) => ({
      id: r.cargo_event_id,
      tripTicketId: r.trip_ticket_id,
      ticketNo: r.ticket_no,
      route: `${r.origin} → ${r.destination}`,
      eventType: r.event_type,
      quantity: r.quantity == null ? null : Number(r.quantity),
      condition: r.cargo_condition,
      counterparty: r.counterparty,
      reason: r.reason,
      notes: r.notes,
      handledBy: r.handled_by_name?.trim() || "System",
      createdAt: r.created_at,
    })),
  });
}

/* GET /warehouse/cargo/stats */
export async function cargoStats(req, res) {
  const { companyId, branchId } = req.context;
  const [[q]] = await db.execute(
    `SELECT
       (SELECT COUNT(*) FROM trip_tickets tt WHERE tt.company_id = ? AND tt.branch_id = ?
          AND tt.status IN ('assigned','accepted','released')
          AND NOT EXISTS (SELECT 1 FROM cargo_events ce WHERE ce.trip_ticket_id = tt.trip_ticket_id AND ce.event_type='release')) AS pending_release,
       (SELECT COUNT(*) FROM trip_tickets tt WHERE tt.company_id = ? AND tt.branch_id = ?
          AND tt.status IN ('cancelled','delivered','operationally_closed','rejected')
          AND EXISTS (SELECT 1 FROM cargo_events ce WHERE ce.trip_ticket_id = tt.trip_ticket_id AND ce.event_type='release')
          AND NOT EXISTS (SELECT 1 FROM cargo_events ce WHERE ce.trip_ticket_id = tt.trip_ticket_id AND ce.event_type='return')) AS pending_return,
       (SELECT COUNT(*) FROM cargo_events ce WHERE ce.company_id = ? AND ce.event_type='release' AND DATE(ce.created_at) = CURRENT_DATE) AS released_today,
       (SELECT COUNT(*) FROM cargo_events ce WHERE ce.company_id = ? AND ce.event_type='return') AS total_returned`,
    [companyId, branchId, companyId, branchId, companyId, companyId]
  );
  res.json({
    success: true,
    data: {
      pendingRelease: Number(q.pending_release),
      pendingReturn: Number(q.pending_return),
      releasedToday: Number(q.released_today),
      totalReturned: Number(q.total_returned),
    },
  });
}

async function logCargo(req, res, eventType) {
  const { companyId, branchId, userId } = req.context;
  const b = req.body;
  const tripId = NUM(b.tripTicketId);
  if (!tripId) return res.status(400).json({ success: false, message: "A trip ticket is required." });

  const [[trip]] = await db.execute(
    "SELECT trip_ticket_id, status FROM trip_tickets WHERE trip_ticket_id = ? AND company_id = ? AND branch_id = ?",
    [tripId, companyId, branchId]
  );
  if (!trip) return res.status(404).json({ success: false, message: "Trip not found." });

  if (eventType === "release") {
    if (!["assigned", "accepted", "released"].includes(trip.status)) {
      return res.status(409).json({ success: false, message: "Cargo can only be released for a dispatched trip." });
    }
    const [[dupe]] = await db.execute(
      "SELECT cargo_event_id FROM cargo_events WHERE trip_ticket_id = ? AND event_type = 'release'",
      [tripId]
    );
    if (dupe) return res.status(409).json({ success: false, message: "Cargo for this trip has already been released." });
  } else {
    if (["draft", "for_validation", "for_approval", "approved", "assigned", "accepted"].includes(trip.status)) {
      return res.status(409).json({ success: false, message: "Cargo hasn't left the warehouse yet — nothing to return." });
    }
    const [[released]] = await db.execute(
      "SELECT cargo_event_id FROM cargo_events WHERE trip_ticket_id = ? AND event_type = 'release'",
      [tripId]
    );
    if (!released) return res.status(409).json({ success: false, message: "Nothing to return — cargo for this trip was never released." });
    const [[dupe]] = await db.execute(
      "SELECT cargo_event_id FROM cargo_events WHERE trip_ticket_id = ? AND event_type = 'return'",
      [tripId]
    );
    if (dupe) return res.status(409).json({ success: false, message: "A return has already been logged for this trip." });
  }

  const conn = await db.getConnection();
  let insertId;
  let tripAdvanced = false;
  try {
    await conn.beginTransaction();

    const [ins] = await conn.execute(
      `INSERT INTO cargo_events
         (company_id, branch_id, trip_ticket_id, event_type, quantity, cargo_condition, counterparty, reason, notes, handled_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId, branchId, tripId, eventType,
        NUM(b.quantity),
        ["good", "damaged", "partial"].includes(b.condition) ? b.condition : "good",
        STR(b.counterparty),
        eventType === "return" ? STR(b.reason) : null,
        STR(b.notes),
        userId,
      ]
    );
    insertId = ins.insertId;

    // Releasing cargo is what actually hands the trip to the driver — advance it
    // to `released` so the driver can start. (If ops already released it via the
    // trip screen, `trip.status` is already `released` and this is a no-op.)
    if (eventType === "release" && ["assigned", "accepted"].includes(trip.status)) {
      await conn.execute(
        "UPDATE trip_tickets SET status = 'released' WHERE trip_ticket_id = ?",
        [tripId]
      );
      await conn.execute(
        `INSERT INTO trip_status_history
           (company_id, branch_id, trip_ticket_id, from_status, to_status, action, remarks, changed_by)
         VALUES (?, ?, ?, ?, 'released', 'RELEASE_TRIP', ?, ?)`,
        [companyId, branchId, tripId, trip.status, "Cargo released by warehouse", userId]
      );
      await conn.execute(
        `UPDATE trip_assignments SET status = 'released'
          WHERE trip_ticket_id = ? AND is_current = TRUE AND status NOT IN ('completed', 'cancelled')`,
        [tripId]
      );
      tripAdvanced = true;
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  if (tripAdvanced) {
    publish(companyId, branchId, { type: "trip:status", tripId, status: "released", from: trip.status });
  }

  await recordAudit(req, {
    module: "warehouse", action: `cargo.${eventType}`, entityType: "cargo_event", entityId: insertId,
    summary: `Cargo ${eventType} for trip #${tripId}${tripAdvanced ? " (trip released)" : ""}`,
  });
  res.status(201).json({
    success: true,
    message: tripAdvanced ? "Cargo released — the trip is now ready for the driver to start." : `Cargo ${eventType} logged.`,
    data: { cargoEventId: insertId, tripStatus: tripAdvanced ? "released" : trip.status },
  });
}

export const releaseCargo = (req, res) => logCargo(req, res, "release");
export const returnCargo = (req, res) => logCargo(req, res, "return");
