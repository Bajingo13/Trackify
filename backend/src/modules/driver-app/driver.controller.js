import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { publish } from "../../realtime/hub.js";

const ACTIVE = ["assigned", "accepted", "released", "in_transit"];

/* ---------------------------------------------------------------- */
/* Auth                                                             */
/* ---------------------------------------------------------------- */

export async function login(req, res) {
  const employeeNo = String(req.body.employeeNo || "").trim();
  const pin = String(req.body.pin || "").trim();
  if (!employeeNo || !pin) {
    return res.status(400).json({ success: false, message: "Employee number and PIN are required." });
  }

  const [candidates] = await db.execute(
    `SELECT driver_id, company_id, home_branch_id, first_name, last_name, pin_hash
       FROM drivers
      WHERE employee_no = ? AND status = 'active' AND app_enabled = 1 AND pin_hash IS NOT NULL`,
    [employeeNo]
  );

  let matched = null;
  for (const d of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(pin, d.pin_hash)) { matched = d; break; }
  }
  if (!matched) {
    return res.status(401).json({ success: false, message: "Wrong employee number or PIN." });
  }

  const token = jwt.sign(
    { kind: "driver", driverId: matched.driver_id, companyId: matched.company_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.DRIVER_JWT_EXPIRES_IN || "12h" }
  );
  res.json({
    success: true,
    data: {
      token,
      driver: {
        driverId: matched.driver_id,
        name: `${matched.first_name} ${matched.last_name}`.trim(),
        employeeNo,
      },
    },
  });
}

export function me(req, res) {
  res.json({ success: true, data: req.driver });
}

/* ---------------------------------------------------------------- */
/* Trips                                                            */
/* ---------------------------------------------------------------- */

const TRIP_SELECT = `
  tt.trip_ticket_id AS id, tt.ticket_no AS ticketNo, tt.status,
  tt.origin, tt.origin_lat AS originLat, tt.origin_lng AS originLng,
  tt.destination, tt.destination_lat AS destLat, tt.destination_lng AS destLng,
  tt.route_distance_km AS routeKm, tt.route_duration_min AS routeMin,
  tt.route_geometry AS routeGeom,
  tt.scheduled_departure AS scheduledDeparture, tt.scheduled_arrival AS scheduledArrival,
  tt.cargo_description AS cargo, tt.special_instructions AS instructions,
  c.customer_name AS customer, v.plate_no AS vehicle, v.vehicle_type AS vehicleType,
  (SELECT tp.recorded_at FROM trip_tracking_points tp
     WHERE tp.trip_ticket_id = tt.trip_ticket_id ORDER BY tp.recorded_at DESC LIMIT 1) AS lastPingAt
`;

export async function myTrips(req, res) {
  const { driverId, companyId } = req.driver;
  const [rows] = await db.execute(
    `SELECT ${TRIP_SELECT}
       FROM trip_assignments ta
       JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
       LEFT JOIN customers c ON c.customer_id = tt.customer_id
       LEFT JOIN vehicles v ON v.vehicle_id = ta.vehicle_id
      WHERE ta.driver_id = ? AND ta.is_current = TRUE AND tt.company_id = ?
        AND (tt.status IN ('assigned','accepted','released','in_transit')
             OR (tt.status = 'delivered' AND tt.updated_at >= NOW() - INTERVAL 1 DAY))
      ORDER BY FIELD(tt.status,'in_transit','released','accepted','assigned','delivered'),
               tt.scheduled_departure`,
    [driverId, companyId]
  );
  res.json({ success: true, data: rows });
}

async function loadMyTrip(driverId, companyId, tripId) {
  const [[row]] = await db.execute(
    `SELECT ${TRIP_SELECT}, ta.status AS assignmentStatus
       FROM trip_assignments ta
       JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
       LEFT JOIN customers c ON c.customer_id = tt.customer_id
       LEFT JOIN vehicles v ON v.vehicle_id = ta.vehicle_id
      WHERE ta.driver_id = ? AND ta.is_current = TRUE
        AND tt.company_id = ? AND tt.trip_ticket_id = ? LIMIT 1`,
    [driverId, companyId, tripId]
  );
  return row || null;
}

export async function getTrip(req, res) {
  const trip = await loadMyTrip(req.driver.driverId, req.driver.companyId, Number(req.params.id));
  if (!trip) return res.status(404).json({ success: false, message: "That trip isn't assigned to you." });
  res.json({ success: true, data: trip });
}

/* ---------------------------------------------------------------- */
/* GPS ping                                                         */
/* ---------------------------------------------------------------- */

export async function ping(req, res) {
  const { driverId, companyId, branchId } = req.driver;
  const tripId = Number(req.params.id);
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ success: false, message: "lat and lng are required." });
  }

  const [[asg]] = await db.execute(
    `SELECT ta.vehicle_id, tt.status
       FROM trip_assignments ta
       JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
      WHERE ta.trip_ticket_id = ? AND ta.driver_id = ? AND ta.is_current = TRUE
        AND tt.company_id = ? LIMIT 1`,
    [tripId, driverId, companyId]
  );
  if (!asg) return res.status(404).json({ success: false, message: "Trip not found." });
  if (!["released", "in_transit"].includes(asg.status)) {
    return res.status(409).json({ success: false, message: "Tracking is only active once the trip is released." });
  }

  await db.execute(
    `INSERT INTO trip_tracking_points
       (company_id, branch_id, trip_ticket_id, driver_id, vehicle_id,
        latitude, longitude, speed_kph, heading, accuracy_meters, gps_status, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', NOW())`,
    [
      companyId, branchId, tripId, driverId, asg.vehicle_id,
      lat, lng,
      req.body.speedKph != null ? Number(req.body.speedKph) : null,
      req.body.heading != null ? Number(req.body.heading) : null,
      req.body.accuracyMeters != null ? Number(req.body.accuracyMeters) : null,
    ]
  );
  publish(companyId, branchId, {
    type: "trip:location",
    tripId,
    lat,
    lng,
    speedKph: req.body.speedKph != null ? Number(req.body.speedKph) : null,
    heading: req.body.heading != null ? Number(req.body.heading) : null,
    recordedAt: new Date().toISOString(),
  });

  res.status(201).json({ success: true });
}

/* ---------------------------------------------------------------- */
/* Driver-side transitions                                          */
/* ---------------------------------------------------------------- */

async function driverTransition(req, res, { from, to, action, requireReceivedBy }) {
  const { driverId, companyId, branchId, name } = req.driver;
  const tripId = Number(req.params.id);

  let remark = `by driver ${name}`;
  if (requireReceivedBy) {
    const receivedBy = String(req.body.receivedBy || "").trim();
    if (!receivedBy) {
      return res.status(400).json({ success: false, message: "Enter who received the delivery." });
    }
    remark = `POD — received by ${receivedBy} (driver ${name})`;
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.execute(
      `SELECT tt.status
         FROM trip_tickets tt
         JOIN trip_assignments ta ON ta.trip_ticket_id = tt.trip_ticket_id
        WHERE tt.trip_ticket_id = ? AND ta.driver_id = ? AND ta.is_current = TRUE
          AND tt.company_id = ? FOR UPDATE`,
      [tripId, driverId, companyId]
    );
    if (!row) { await conn.rollback(); return res.status(404).json({ success: false, message: "That trip isn't assigned to you." }); }
    if (row.status !== from) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: `This trip is ${row.status.replace(/_/g, " ")} — you can't do that now.` });
    }

    const extra = to === "in_transit" ? ", actual_departure = COALESCE(actual_departure, NOW())"
      : to === "delivered" ? ", actual_arrival = NOW()" : "";
    await conn.execute(`UPDATE trip_tickets SET status = ?${extra} WHERE trip_ticket_id = ?`, [to, tripId]);
    await conn.execute(
      `INSERT INTO trip_status_history (company_id, branch_id, trip_ticket_id, from_status, to_status, action, remarks, changed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      [companyId, branchId, tripId, from, to, action, remark]
    );
    await conn.commit();
    publish(companyId, branchId, { type: "trip:status", tripId, status: to, from });
    await recordAudit(req, { module: "driver-app", action: `trip.${action.toLowerCase()}`, entityType: "trip_ticket", entityId: tripId, summary: `Driver ${name}: ${from} → ${to}` });
    res.json({ success: true, data: { status: to } });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export const startTrip = (req, res) => driverTransition(req, res, { from: "released", to: "in_transit", action: "START_TRANSIT" });
export const deliverTrip = (req, res) => driverTransition(req, res, { from: "in_transit", to: "delivered", action: "CONFIRM_DELIVERY", requireReceivedBy: true });
