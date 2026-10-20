import fsSync from "node:fs";
import bcrypt from "bcrypt";
import db from "../../config/db.js";
import {
  askOffice, CODE_TTL_MINUTES, isDeviceKey, maskEmail, pendingStatus, readPendingToken, requestOfficeApproval,
  resendDeviceCode, resolveSignIn, sendDeviceCode, signDriverToken, signPendingToken, verifyWithCode, warnTrustedPhone,
} from "./devices.service.js";
import { recordAudit } from "../../shared/audit.js";
import { isDemoPin, isProduction } from "../../shared/demoCredentials.js";
import { checkCompanyLicense, licenseRefusal } from "../../shared/license.js";
import { toRelative, discard, streamFile } from "../finance/receipts.storage.js";
import { publish } from "../../realtime/hub.js";
import { issueDriverRealtimeTicket } from "../../realtime/ticket.js";
import { endForTrip } from "../support/pause.service.js";
import { matchTrail, haversineKm } from "../operations/geo.service.js";

const ACTIVE = ["assigned", "accepted", "released", "in_transit"];

/* ---------------------------------------------------------------- */
/* Auth                                                             */
/* ---------------------------------------------------------------- */

/**
 * GET /api/v1/driver/realtime-ticket — a one-minute ticket for the live socket,
 * which then carries only this driver's own events: a new message from
 * dispatch, an answer on Help & Support, a decision on a pause.
 */
export function realtimeTicket(req, res) {
  const ticket = issueDriverRealtimeTicket({
    driverId: req.driver.driverId, companyId: req.driver.companyId, deviceId: req.driver.deviceId,
  });
  res.json({ success: true, data: { ticket, expiresIn: 60 } });
}

export async function login(req, res) {
  const employeeNo = String(req.body.employeeNo || "").trim();
  const pin = String(req.body.pin || "").trim();
  if (!employeeNo || !pin) {
    return res.status(400).json({ success: false, message: "Employee number and PIN are required." });
  }

  /*
   * The published demonstration PIN is refused outright in production.
   *
   * 1234 is in the repository, the seed data and every demonstration ever
   * given, so it is not a secret and cannot be treated as one. This used to be
   * handled by refusing to start the server at all, which took production down
   * for a day over a single seeded driver while every real one waited. Shutting
   * this one door closes the same hole and leaves the fleet working.
   *
   * Refused before the hashes are compared, so it costs nothing on a normal
   * sign-in and reveals nothing about whether that employee number exists.
   */
  if (isProduction() && isDemoPin(pin)) {
    await recordAudit(req, {
      module: "driver-app",
      action: "sign_in.blocked",
      entityType: "driver",
      summary: `Driver App sign-in blocked for ${employeeNo}: the published demonstration PIN`,
    });
    return res.status(401).json({
      success: false,
      message: "That PIN is no longer accepted. Ask your dispatcher to set a new one for you.",
    });
  }

  /*
   * The phone's own key (devices.service.js). An app from before phones were
   * recorded sends none; letting it in without one would leave the PIN as the
   * whole account again, so it is told to update instead.
   */
  const deviceKey = req.headers["x-driver-device"];
  if (!isDeviceKey(deviceKey)) {
    return res.status(426).json({
      success: false,
      message: "Update Trackify Driver to the latest version to sign in.",
    });
  }

  const [candidates] = await db.execute(
    `SELECT driver_id, company_id, home_branch_id, first_name, last_name, pin_hash
       FROM drivers
      WHERE employee_no = ? AND status = 'active' AND app_enabled = 1 AND pin_hash IS NOT NULL`,
    [employeeNo]
  );

  /*
   * Every account whose PIN matches, not merely the first.
   *
   * employee_no is unique within a company, and this screen is not told which
   * company the driver belongs to — so two firms can each hold a DRV-001. If
   * both PINs also match, and four digits repeat often enough that they will,
   * taking the first would sign somebody into another company's trips. There
   * is no safe guess available, so it refuses and says what to do.
   */
  const matches = [];
  for (const d of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(pin, d.pin_hash)) matches.push(d);
  }

  if (matches.length === 0) {
    // No company to attribute this to — the number matched nobody, or the PIN
    // did. recordAudit tolerates a missing context, which is the honest shape
    // for an attempt that never became a session.
    await recordAudit(req, {
      module: "driver-app",
      action: "sign_in.failed",
      entityType: "driver",
      summary: `Failed Driver App sign-in for ${employeeNo}`,
    });
    return res.status(401).json({ success: false, message: "Wrong employee number or PIN." });
  }
  if (matches.length > 1) {
    return res.status(409).json({
      success: false,
      message: "That employee number and PIN match more than one account. Ask your office to change your PIN.",
    });
  }
  const matched = matches[0];

  const license = await checkCompanyLicense(db, matched.company_id);
  if (!license.valid) {
    req.context = { companyId: matched.company_id, branchId: matched.home_branch_id };
    req.user = { userId: null, email: `driver:${employeeNo}` };
    await recordAudit(req, {
      module: "driver-app",
      action: "sign_in.refused",
      entityType: "driver",
      entityId: matched.driver_id,
      summary: `Driver ${employeeNo} refused — license ${license.state}`,
    });
    return res.status(403).json(licenseRefusal(license));
  }

  const userAgent = req.headers["user-agent"];
  const device = await resolveSignIn({
    driver: matched,
    deviceKey,
    userAgent,
    ip: req.ip || req.socket?.remoteAddress,
  });

  // Driver routes sit outside the staff context chain, so the audit row is
  // scoped explicitly rather than recorded against no company at all.
  req.context = { companyId: matched.company_id, branchId: matched.home_branch_id };
  req.user = { userId: null, email: `driver:${employeeNo}` };
  const driverInfo = {
    driverId: matched.driver_id,
    name: `${matched.first_name} ${matched.last_name}`.trim(),
    employeeNo,
  };

  if (device.outcome === "blocked") {
    await recordAudit(req, {
      module: "driver-app",
      action: "device.blocked",
      entityType: "driver",
      entityId: matched.driver_id,
      summary: `Driver ${employeeNo}'s PIN was used on a phone the office signed out; refused`,
      metadata: { deviceId: device.deviceId, userAgent },
    });
    return res.status(403).json({
      success: false,
      message: "This phone was signed out by your office and can't be used for your account. Call your office.",
    });
  }

  if (device.outcome === "pending" || device.outcome === "locked") {
    const driverRow = { ...matched, employee_no: employeeNo };
    const ids = { driverId: matched.driver_id, companyId: matched.company_id, deviceId: device.deviceId };
    const locked = device.outcome === "locked";

    // The code goes out the moment the PIN is right: nothing for the driver to
    // press. Without an email, or locked out, only the office can help, so it
    // is asked straight away.
    let mail = null;
    if (!locked && device.email) {
      mail = await sendDeviceCode({
        driver: driverRow, deviceId: device.deviceId, email: device.email,
        firstPhone: device.firstPhone, userAgent,
      });
    }
    if (locked || !device.email) await askOffice(ids);
    if (device.hadPhone) await warnTrustedPhone({ driver: driverRow, deviceId: device.deviceId });

    await recordAudit(req, {
      module: "driver-app",
      action: "device.pending",
      entityType: "driver",
      entityId: matched.driver_id,
      summary: device.firstPhone
        ? `Driver ${employeeNo} signed in for the first time; ${mail?.sent ? "a code was emailed" : "waiting for the office"}`
        : `Driver ${employeeNo} signed in on a new phone; ${mail?.sent ? "a code was emailed" : "waiting for the office"}`,
      metadata: { deviceId: device.deviceId, userAgent, locked, emailed: Boolean(mail?.sent), firstPhone: device.firstPhone },
    });

    // 200, not 401: the PIN was right, and the sign-in throttle must not count it as a guess.
    return res.json({
      success: true,
      data: {
        status: "device_verification_required",
        locked,
        firstPhone: Boolean(device.firstPhone),
        // Where the code went, masked; null when there is no email on file.
        emailHint: device.email ? maskEmail(device.email) : null,
        emailSent: Boolean(mail?.sent),
        emailError: mail && !mail.sent ? mail.error : null,
        codeMinutes: CODE_TTL_MINUTES,
        pendingToken: signPendingToken(ids),
        driver: driverInfo,
      },
    });
  }

  const token = signDriverToken({
    driverId: matched.driver_id, companyId: matched.company_id, deviceId: device.deviceId,
  });
  await recordAudit(req, {
    module: "driver-app",
    action: "sign_in",
    entityType: "driver",
    entityId: matched.driver_id,
    summary: device.outcome === "enrolled"
      ? `Driver ${employeeNo} signed in and set up this phone as their trusted phone`
      : `Driver ${employeeNo} signed in`,
    metadata: { deviceId: device.deviceId, userAgent, newTrustedPhone: device.outcome === "enrolled" },
  });

  res.json({ success: true, data: { token, driver: driverInfo } });
}

const expired = (res) => res.status(401).json({ success: false, message: "This sign-in has expired. Sign in again." });

/** Driver routes sit outside the staff context chain, so audit rows are scoped explicitly. */
function asPendingDriver(req, pending) {
  req.context = { companyId: pending.companyId, branchId: null };
  req.user = { userId: null, email: `driver:#${pending.driverId}` };
}

/** POST /driver/auth/device/verify — a waiting phone enters the code that was emailed. */
export async function verifyDevice(req, res) {
  const pending = readPendingToken(req.body?.pendingToken);
  if (!pending) return expired(res);
  const result = await verifyWithCode({
    pending, code: req.body?.code, deviceKey: req.headers["x-driver-device"],
  });

  asPendingDriver(req, pending);
  if (result.error) {
    // Only a code that was actually tried and wrong is recorded as one; a sign-in
    // that has moved on (approved, refused, expired) is not a guess.
    if (result.wrongCode) await recordAudit(req, {
      module: "driver-app",
      action: result.locked ? "device.locked" : "device.verify_failed",
      entityType: "driver",
      entityId: pending.driverId,
      summary: result.locked
        ? `Driver #${pending.driverId} locked out of phone sign-in after too many wrong codes`
        : `Wrong emailed code for driver #${pending.driverId}`,
      metadata: { deviceId: pending.deviceId },
    });
    return res.status(result.status).json({
      success: false, message: result.error, attemptsLeft: result.attemptsLeft, expired: Boolean(result.expired),
    });
  }
  await recordAudit(req, {
    module: "driver-app",
    action: "device.verified",
    entityType: "driver",
    entityId: pending.driverId,
    summary: result.firstPhone
      ? `Driver #${pending.driverId} verified their email and set up their trusted phone`
      : `Driver #${pending.driverId} moved to a new phone with an emailed code; the old phone was signed out`,
    metadata: { deviceId: pending.deviceId, firstPhone: result.firstPhone },
  });
  res.json({ success: true, data: { token: result.token } });
}

/** POST /driver/auth/device/resend — email a new code; the last one stops working. */
export async function resendDeviceEmail(req, res) {
  const pending = readPendingToken(req.body?.pendingToken);
  if (!pending) return expired(res);
  const result = await resendDeviceCode({
    pending, deviceKey: req.headers["x-driver-device"], userAgent: req.headers["user-agent"],
  });
  if (!result.sent) {
    return res.status(result.status).json({ success: false, message: result.error, retryAfter: result.retryAfter });
  }
  asPendingDriver(req, pending);
  await recordAudit(req, {
    module: "driver-app",
    action: "device.code_resent",
    entityType: "driver",
    entityId: pending.driverId,
    summary: `A new sign-in code was emailed to driver #${pending.driverId}`,
    metadata: { deviceId: pending.deviceId },
  });
  res.json({ success: true, data: { emailSent: true, codeMinutes: CODE_TTL_MINUTES } });
}

/** POST /driver/auth/device/ask-office — no access to the email: put the phone in front of the office. */
export async function askOfficeForDevice(req, res) {
  const pending = readPendingToken(req.body?.pendingToken);
  if (!pending) return expired(res);
  const result = await requestOfficeApproval({ pending, deviceKey: req.headers["x-driver-device"] });
  if (result.error) return res.status(result.status).json({ success: false, message: result.error });
  asPendingDriver(req, pending);
  await recordAudit(req, {
    module: "driver-app",
    action: "device.office_requested",
    entityType: "driver",
    entityId: pending.driverId,
    summary: `Driver #${pending.driverId} asked the office to approve a phone`,
    metadata: { deviceId: pending.deviceId },
  });
  res.json({ success: true });
}

/** POST /driver/auth/device/status — a waiting phone asks whether the office approved it. */
export async function deviceStatus(req, res) {
  const pending = readPendingToken(req.body?.pendingToken);
  if (!pending) return expired(res);
  const result = await pendingStatus({ pending, deviceKey: req.headers["x-driver-device"] });
  res.json({ success: true, data: result });
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
  c.customer_name AS customer, c.contact_person AS customerContact, c.phone AS customerPhone,
  v.plate_no AS vehicle, v.vehicle_type AS vehicleType,
  (SELECT tp.recorded_at FROM trip_tracking_points tp
     WHERE tp.trip_ticket_id = tt.trip_ticket_id ORDER BY tp.recorded_at DESC LIMIT 1) AS lastPingAt,
  -- The pause on this run that is waiting for the office ('pending') or in force
  -- ('approved'), and why; NULL when none. The trip's own status stays
  -- in_transit underneath (see support/pause.service.js), so Today and the
  -- run screen read this to say "Paused" rather than "In transit".
  (SELECT p.status FROM trip_pauses p
     WHERE p.trip_ticket_id = tt.trip_ticket_id AND p.status IN ('pending','approved')
     ORDER BY p.pause_id DESC LIMIT 1) AS pauseStatus,
  (SELECT p.reason FROM trip_pauses p
     WHERE p.trip_ticket_id = tt.trip_ticket_id AND p.status IN ('pending','approved')
     ORDER BY p.pause_id DESC LIMIT 1) AS pauseReason
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
/* The route driven, once the run is done                           */
/* ---------------------------------------------------------------- */

const DONE_STATUSES = ["delivered", "returned", "operationally_closed"];

/**
 * The driver's own GPS trail for a finished run, to look back on. Only their
 * own fixes: a run handed over mid-way shows the part this driver drove.
 * Fixes past the company's retention window are gone, so the trail can be empty.
 */
export async function myTrail(req, res) {
  const { driverId, companyId } = req.driver;
  const tripId = Number(req.params.id);
  const trip = await loadMyTrip(driverId, companyId, tripId);
  if (!trip) return res.status(404).json({ success: false, message: "That trip isn't assigned to you." });
  if (!DONE_STATUSES.includes(trip.status)) {
    return res.status(409).json({ success: false, message: "The route driven is shown once the run is delivered." });
  }

  const [rows] = await db.execute(
    `SELECT latitude, longitude, recorded_at
       FROM trip_tracking_points
      WHERE trip_ticket_id = ? AND company_id = ? AND driver_id = ?
      ORDER BY recorded_at ASC`,
    [tripId, companyId, driverId]
  );
  const points = rows
    .map((p) => ({ lat: Number(p.latitude), lng: Number(p.longitude), at: p.recorded_at }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);

  // Snapped to the roads when the matcher answers; otherwise the app draws the raw fixes.
  let snapped = null;
  try {
    snapped = await matchTrail(points);
  } catch {
    /* keep null */
  }

  res.json({
    success: true,
    data: {
      points,
      snapped,
      distanceKm: Math.round(km * 100) / 100,
      startedAt: points[0]?.at ?? null,
      endedAt: points[points.length - 1]?.at ?? null,
    },
  });
}

/* ---------------------------------------------------------------- */
/* GPS ping                                                         */
/* ---------------------------------------------------------------- */

export async function ping(req, res) {
  const { driverId, companyId } = req.driver;
  const tripId = Number(req.params.id);
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ success: false, message: "lat and lng are required." });
  }
  // A point off the globe is a broken reading, not a place: stored, it would
  // sit in the trip's history and jump the truck on dispatch's live map.
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ success: false, message: "lat must be between -90 and 90, and lng between -180 and 180." });
  }

  const [[asg]] = await db.execute(
    `SELECT ta.vehicle_id, tt.status, tt.branch_id
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

  // Cross-branch assignments are valid. Tracking belongs to the trip's
  // operating branch, not the driver's home branch, so the dispatch team that
  // owns the trip receives both history and realtime updates.
  const tripBranchId = Number(asg.branch_id);

  await db.execute(
    `INSERT INTO trip_tracking_points
       (company_id, branch_id, trip_ticket_id, driver_id, vehicle_id,
        latitude, longitude, speed_kph, heading, accuracy_meters, gps_status, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', NOW())`,
    [
      companyId, tripBranchId, tripId, driverId, asg.vehicle_id,
      lat, lng,
      req.body.speedKph != null ? Number(req.body.speedKph) : null,
      req.body.heading != null ? Number(req.body.heading) : null,
      req.body.accuracyMeters != null ? Number(req.body.accuracyMeters) : null,
    ]
  );
  publish(companyId, tripBranchId, {
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
  const { driverId, companyId, name } = req.driver;
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
    // The photo is the evidence; the name is only checked against it. The app
    // already refuses to confirm without one, and an older build that skips it
    // must be refused here rather than leave a delivery nobody can prove.
    if (!photo) {
      return bail(400, "Take a photo of the delivery first.");
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
    remark = `POD — received by ${pod.receivedBy} (driver ${name}) with photo`;
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.execute(
      `SELECT tt.status, tt.branch_id
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
    const tripBranchId = Number(row.branch_id);

    const extra = to === "in_transit" ? ", actual_departure = COALESCE(actual_departure, NOW())"
      : to === "delivered" ? ", actual_arrival = NOW()" : "";
    await conn.execute(`UPDATE trip_tickets SET status = ?${extra} WHERE trip_ticket_id = ?`, [to, tripId]);
    await conn.execute(
      `INSERT INTO trip_status_history (company_id, branch_id, trip_ticket_id, from_status, to_status, action, remarks, changed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      [companyId, tripBranchId, tripId, from, to, action, remark]
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
    // the delivery ends any pause on it; best effort, it cannot fail a delivery that is done
    if (to === "delivered") await endForTrip(tripId);
    publish(companyId, tripBranchId, { type: "trip:status", tripId, status: to, from });
    req.context = { ...req.context, companyId, branchId: tripBranchId };
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
  const { toAbsolute, streamFile } = await import("../finance/receipts.storage.js");
  const abs = toAbsolute(p.photo_path);
  if (!fsSync.existsSync(abs)) return res.status(404).json({ success: false, message: "Photo file is missing." });
  res.type(p.photo_mime);
  streamFile(res, abs);
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

  const { toAbsolute, streamFile } = await import("../finance/receipts.storage.js");
  const abs = toAbsolute(row.photo_path);
  if (!fsSync.existsSync(abs)) {
    return res.status(404).json({ success: false, message: "The photo file is missing." });
  }
  res.set("Cache-Control", "private, max-age=604800");
  res.type(row.photo_mime);
  streamFile(res, abs);
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
  const { driverId, companyId, name } = req.driver;
  const tripId = Number(req.params.id);
  const stopId = Number(req.params.stopId);

  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const note = String(req.body?.note || "").trim().slice(0, 255) || null;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[trip]] = await conn.execute(
      `SELECT tt.trip_ticket_id, tt.status, tt.ticket_no, tt.branch_id
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
    const tripBranchId = Number(trip.branch_id);

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
        companyId, tripBranchId, tripId, trip.status, trip.status,
        `Reached ${stop.location_name}${note ? ` — ${note}` : ""} (driver ${name})`,
      ]
    );

    await conn.commit();

    publish(companyId, tripBranchId, { type: "trip:stop", tripId, stopId });

    req.context = { ...req.context, companyId, branchId: tripBranchId };
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
