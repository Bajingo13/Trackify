import fsSync from "node:fs";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { toRelative, discard } from "../finance/receipts.storage.js";
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
             -- a just-delivered run stays visible so the driver can still file
             -- receipts for it; one day was too tight for a late arrival
             OR (tt.status = 'delivered' AND tt.updated_at >= NOW() - INTERVAL 3 DAY))
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
  if (!row) return null;
  const [stops] = await db.execute(
    `SELECT stop_id AS id, stop_order AS "order", location_name AS label,
            latitude AS lat, longitude AS lng, stop_type AS type,
            planned_arrival AS plannedArrival, actual_arrival AS arrivedAt,
            arrival_note AS arrivalNote
       FROM trip_stops WHERE trip_ticket_id = ? ORDER BY stop_order`,
    [tripId]
  );
  return { ...row, stops };
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
  const photo = req.file || null;

  const bail = (status, message) => {
    if (photo) discard(photo.path);
    return res.status(status).json({ success: false, message });
  };

  let remark = `by driver ${name}`;
  let pod = null;
  if (requireReceivedBy) {
    const receivedBy = String(req.body.receivedBy || "").trim();
    if (!receivedBy) {
      return bail(400, "Enter who received the delivery.");
    }
    // the fix is where the driver was standing, not where the trip was
    // planned to end — null when the device had no fix to give
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    pod = {
      receivedBy: receivedBy.slice(0, 150),
      note: String(req.body.note || "").trim().slice(0, 255) || null,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    };
    remark = `POD — received by ${pod.receivedBy} (driver ${name})${photo ? " with photo" : ""}`;
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
    if (!row) { await conn.rollback(); return bail(404, "That trip isn't assigned to you."); }
    if (row.status !== from) {
      await conn.rollback();
      return bail(409, `This trip is ${row.status.replace(/_/g, " ")} — you can't do that now.`);
    }

    const extra = to === "in_transit" ? ", actual_departure = COALESCE(actual_departure, NOW())"
      : to === "delivered" ? ", actual_arrival = NOW()" : "";
    await conn.execute(`UPDATE trip_tickets SET status = ?${extra} WHERE trip_ticket_id = ?`, [to, tripId]);
    await conn.execute(
      `INSERT INTO trip_status_history (company_id, branch_id, trip_ticket_id, from_status, to_status, action, remarks, changed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      [companyId, branchId, tripId, from, to, action, remark]
    );

    if (pod) {
      // one POD per trip is enforced by a unique key, so a duplicate
      // confirmation cannot slip through a race between two requests
      await conn.execute(
        `INSERT INTO trip_pod
           (trip_ticket_id, company_id, driver_id, received_by, note,
            captured_lat, captured_lng, captured_at, photo_path, photo_mime, photo_size)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
        [
          tripId, companyId, driverId, pod.receivedBy, pod.note,
          pod.lat, pod.lng,
          photo ? toRelative(photo.path) : null,
          photo ? photo.mimetype : null,
          photo ? photo.size : null,
        ]
      );
    }

    await conn.commit();
    publish(companyId, branchId, { type: "trip:status", tripId, status: to, from });
    await recordAudit(req, { module: "driver-app", action: `trip.${action.toLowerCase()}`, entityType: "trip_ticket", entityId: tripId, summary: `Driver ${name}: ${from} → ${to}` });
    res.json({ success: true, data: { status: to } });
  } catch (e) {
    await conn.rollback();
    if (photo) discard(photo.path);
    throw e;
  } finally {
    conn.release();
  }
}

/** The POD photo, to the driver who captured it. */
export async function myPodPhoto(req, res) {
  const { driverId, companyId } = req.driver;
  const [[p]] = await db.execute(
    `SELECT photo_path, photo_mime FROM trip_pod
      WHERE trip_ticket_id = ? AND company_id = ? AND driver_id = ? LIMIT 1`,
    [Number(req.params.id), companyId, driverId]
  );
  if (!p?.photo_path) return res.status(404).json({ success: false, message: "No delivery photo." });
  const { toAbsolute } = await import("../finance/receipts.storage.js");
  const abs = toAbsolute(p.photo_path);
  if (!fsSync.existsSync(abs)) return res.status(404).json({ success: false, message: "Photo file is missing." });
  res.type(p.photo_mime);
  fsSync.createReadStream(abs).pipe(res);
}

/**
 * What this company says a kind of vehicle looks like.
 *
 * The same photograph the web system shows, served to the driver app so the
 * two cannot disagree. Scoped to the driver's own company from the token — a
 * driver never names a company, so one operator's photographs are not
 * reachable from another's app.
 *
 * 404 is the normal answer, not an error: most types have no company photo and
 * the app falls back to the one bundled with it.
 */
export async function vehicleTypePhoto(req, res) {
  const { companyId } = req.driver;
  const vehicleType = String(req.params.type || "").trim().slice(0, 100);
  if (!vehicleType) {
    return res.status(400).json({ success: false, message: "A vehicle type is required." });
  }

  const [[row]] = await db.execute(
    `SELECT photo_path, photo_mime FROM vehicle_type_photos
      WHERE company_id = ? AND vehicle_type = ? LIMIT 1`,
    [companyId, vehicleType]
  );
  if (!row?.photo_path) {
    return res.status(404).json({ success: false, message: "No photo for that type." });
  }

  const { toAbsolute } = await import("../finance/receipts.storage.js");
  const abs = toAbsolute(row.photo_path);
  if (!fsSync.existsSync(abs)) {
    return res.status(404).json({ success: false, message: "The photo file is missing." });
  }
  res.set("Cache-Control", "private, max-age=604800");
  res.type(row.photo_mime);
  fsSync.createReadStream(abs).pipe(res);
}

export const startTrip = (req, res) => driverTransition(req, res, { from: "released", to: "in_transit", action: "START_TRANSIT" });
export const deliverTrip = (req, res) => driverTransition(req, res, { from: "in_transit", to: "delivered", action: "CONFIRM_DELIVERY", requireReceivedBy: true });

/* ---------------------------------------------------------------- */
/* Stops                                                            */
/* ---------------------------------------------------------------- */

/**
 * Mark a stop as reached.
 *
 * Stamps the server's time rather than trusting a phone clock, and stores the
 * position the driver was actually at — which is what makes the record worth
 * anything when a customer later disputes whether the truck came.
 *
 * Only while the trip is moving, and only once per stop: arriving twice is a
 * mis-tap, not an event.
 */
export async function arriveAtStop(req, res) {
  const { driverId, companyId, branchId, name } = req.driver;
  const tripId = Number(req.params.id);
  const stopId = Number(req.params.stopId);

  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const note = String(req.body?.note || "").trim().slice(0, 255) || null;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[trip]] = await conn.execute(
      `SELECT tt.trip_ticket_id, tt.status, tt.ticket_no
         FROM trip_assignments ta
         JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
        WHERE ta.trip_ticket_id = ? AND ta.driver_id = ? AND ta.is_current = TRUE
          AND tt.company_id = ? FOR UPDATE`,
      [tripId, driverId, companyId]
    );
    if (!trip) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: "That trip isn't assigned to you." });
    }
    if (!["released", "in_transit"].includes(trip.status)) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: "You can only log stops once the trip is under way.",
      });
    }

    const [[stop]] = await conn.execute(
      "SELECT stop_id, location_name, actual_arrival FROM trip_stops WHERE stop_id = ? AND trip_ticket_id = ? FOR UPDATE",
      [stopId, tripId]
    );
    if (!stop) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: "That stop isn't on this trip." });
    }
    if (stop.actual_arrival) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: "That stop is already marked as reached." });
    }

    await conn.execute(
      `UPDATE trip_stops
          SET actual_arrival = NOW(), arrived_lat = ?, arrived_lng = ?,
              arrived_by_driver_id = ?, arrival_note = ?
        WHERE stop_id = ?`,
      [
        Number.isFinite(lat) ? lat : null,
        Number.isFinite(lng) ? lng : null,
        driverId,
        note,
        stopId,
      ]
    );

    // the timeline is where anyone looks to see what happened on a trip, so a
    // stop reached has to appear there and not only on the stop row
    await conn.execute(
      `INSERT INTO trip_status_history
         (company_id, branch_id, trip_ticket_id, from_status, to_status, action, remarks, changed_by)
       VALUES (?, ?, ?, ?, ?, 'STOP_ARRIVED', ?, NULL)`,
      [
        companyId, branchId, tripId, trip.status, trip.status,
        `Reached ${stop.location_name}${note ? ` — ${note}` : ""} (driver ${name})`,
      ]
    );

    await conn.commit();

    publish(companyId, branchId, { type: "trip:stop", tripId, stopId });

    req.context = req.context || { companyId, branchId };
    await recordAudit(req, {
      module: "driver-app",
      action: "trip.stop_arrived",
      entityType: "trip_ticket",
      entityId: tripId,
      summary: `Driver ${name} reached ${stop.location_name} on ${trip.ticket_no}`,
    });

    res.json({ success: true, message: "Stop recorded.", data: { stopId } });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
