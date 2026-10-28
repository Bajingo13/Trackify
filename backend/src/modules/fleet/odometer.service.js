import db from "../../config/db.js";
import { requiresOdometer } from "../../shared/companySettings.js";
import { checkClientRef } from "../chat/tripChat.service.js";
import { toRelative } from "../finance/receipts.storage.js";

/**
 * Odometer readings: what the dashboard said at the start and at the end of a
 * trip (migration 061).
 *
 * When the company requires them (company_settings.require_odometer), the
 * driver's Start waits for a start reading and "I've delivered" for an end
 * reading. Only the driver's own steps are held: a trip the office starts or
 * closes is not, because this is a record of distance, not a safety check —
 * the pre-trip inspection is that.
 *
 * One start and one end per trip. A wrong one is corrected by the Fleet team
 * with a reason; the driver's figure is kept as entered. A reading only ever
 * moves the vehicle's odometer forward, as a completed maintenance job does,
 * and only by as much as one trip could drive (advanceVehicleOdometer).
 *
 * The distance driven (end − start) is offered on the trip as actualKm. It
 * does not replace the planned route distance anywhere else — History,
 * reports and finance keep reading route_distance_km until that is decided.
 */

export const MAX_ODOMETER_KM = 9_999_999;
/* More than this between start and end of one trip is a typing error, not a drive. */
export const MAX_TRIP_KM = 3000;
export const MIN_REASON = 5;
const MAX_AGE_S = 48 * 60 * 60;

export const START_REQUIRED = "Enter the odometer reading before starting this trip.";
export const END_REQUIRED = "Enter the odometer reading before confirming delivery.";

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

const km = (v) => (v == null ? null : Number(v));
const shape = (r) => r && {
  id: r.reading_id,
  kind: r.kind,
  valueKm: km(r.value_km),
  correctedValueKm: km(r.corrected_value_km),
  effectiveKm: km(r.corrected_value_km ?? r.value_km),
  capturedAt: r.captured_at,
  hasPhoto: Boolean(r.photo_path),
  correctedAt: r.corrected_at || null,
  correctionReason: r.correction_reason || null,
};

/** A typed number of kilometres, to one decimal, or null when it is not one. */
export function readKm(value) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const n = Math.round(Number(text) * 10) / 10;
  return Number.isFinite(n) && n >= 0 && n <= MAX_ODOMETER_KM ? n : null;
}

/** This trip's start and end readings. */
export async function readingsFor(runner, tripId) {
  let rows;
  try {
    [rows] = await runner.execute(
      `SELECT reading_id, kind, value_km, corrected_value_km, captured_at, photo_path, corrected_at, correction_reason
         FROM trip_odometer_readings WHERE trip_ticket_id = ?`,
      [tripId]
    );
  } catch (e) {
    if (e?.code === "ER_NO_SUCH_TABLE") return { start: null, end: null };
    throw e;
  }
  const list = Array.isArray(rows) ? rows : [];
  return {
    start: shape(list.find((r) => r.kind === "start")) || null,
    end: shape(list.find((r) => r.kind === "end")) || null,
  };
}

/** end − start, from the corrected figures where Fleet corrected them; null until both exist. */
export const actualKm = ({ start, end }) =>
  start && end && end.effectiveKm >= start.effectiveKm ? Math.round((end.effectiveKm - start.effectiveKm) * 10) / 10 : null;

/** What the Driver App needs about the odometer on one trip. */
export async function odometerForDriver(runner, { companyId, tripId }) {
  const required = await requiresOdometer(companyId, runner);
  const readings = await readingsFor(runner, tripId);
  const [rows] = await runner.execute(
    `SELECT v.odometer FROM trip_assignments ta JOIN vehicles v ON v.vehicle_id = ta.vehicle_id
      WHERE ta.trip_ticket_id = ? AND ta.is_current = TRUE LIMIT 1`,
    [tripId]
  );
  const last = Array.isArray(rows) ? km(rows[0]?.odometer) : null;
  return { required, ...readings, lastKnownKm: last || null, actualKm: actualKm(readings) };
}

/**
 * Whether the driver's own step may go ahead. null when it may; otherwise
 * { code, message } for a 409. `to` is the status the step moves the trip to.
 */
export async function odometerGate(runner, { companyId, tripId, to }) {
  if (to !== "in_transit" && to !== "delivered") return null;
  if (!(await requiresOdometer(companyId, runner))) return null;
  const { start, end } = await readingsFor(runner, tripId);
  if (to === "in_transit" && !start) return { code: "odometer_required", message: START_REQUIRED };
  if (to === "delivered" && !end) return { code: "odometer_required", message: END_REQUIRED };
  return null;
}

/*
 * Move the vehicle's odometer up to a reading — never down, and never by more
 * than one trip could drive, so a figure typed with an extra digit cannot
 * inflate the vehicle's record (and its maintenance due-by-km) for good. A
 * vehicle with no figure on record takes the reading as it is.
 */
async function advanceVehicleOdometer(runner, { vehicleId, companyId, value }) {
  await runner.execute(
    `UPDATE vehicles SET odometer = ?
      WHERE vehicle_id = ? AND company_id = ?
        AND (odometer IS NULL OR odometer = 0 OR (? > odometer AND ? - odometer <= ?))`,
    [value, vehicleId, companyId, value, value, MAX_TRIP_KM]
  );
}

const SELECT_MINE = `
  SELECT reading_id, kind, value_km, corrected_value_km, captured_at, photo_path, corrected_at, correction_reason
    FROM trip_odometer_readings`;

/**
 * Record a reading from the Driver App. Returns { reading, duplicate, warning }.
 * Throws an error with `status` for what the driver has to change. `file` is
 * multer's; the caller discards it on a throw or a duplicate.
 */
export async function createForDriver({ driver, tripId, input, file = null }) {
  const clientRef = checkClientRef(input.clientRef);
  if (!clientRef) throw fail(400, "The reading is missing its reference.");

  const [[existing]] = await db.execute(`${SELECT_MINE} WHERE driver_id = ? AND client_ref = ? LIMIT 1`, [driver.driverId, clientRef]);
  if (existing) return { reading: shape(existing), duplicate: true, warning: null };

  const kind = input.kind === "start" || input.kind === "end" ? input.kind : null;
  if (!kind) throw fail(400, "Say whether this is the start or the end reading.");
  const value = readKm(input.valueKm);
  if (value == null) throw fail(400, "Enter the odometer reading in kilometres, as numbers only.");
  const ageMs = Number(input.ageMs);
  const ageS = Number.isFinite(ageMs) ? Math.min(MAX_AGE_S, Math.max(0, Math.round(ageMs / 1000))) : 0;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[trip]] = await conn.execute(
      `SELECT ta.vehicle_id, tt.status, tt.branch_id, v.odometer
         FROM trip_assignments ta
         JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
         LEFT JOIN vehicles v ON v.vehicle_id = ta.vehicle_id
        WHERE ta.trip_ticket_id = ? AND ta.driver_id = ? AND ta.is_current = TRUE
          AND tt.company_id = ? FOR UPDATE`,
      [tripId, driver.driverId, driver.companyId]
    );
    if (!trip) throw fail(404, "That trip isn't assigned to you.");
    if (!trip.vehicle_id) throw fail(409, "No vehicle is assigned to this trip yet.");
    if (kind === "start" && trip.status !== "released") throw fail(409, "The start reading is taken before the trip starts.");
    if (kind === "end" && trip.status !== "in_transit") throw fail(409, "The end reading is taken on the road, before delivery.");

    const readings = await readingsFor(conn, tripId);
    if (readings[kind]) {
      throw fail(409, `The ${kind} reading is already recorded. The Fleet team can correct it if it is wrong.`, { code: "odometer_recorded" });
    }
    if (kind === "end" && readings.start) {
      if (value < readings.start.effectiveKm) {
        throw fail(400, `That is lower than the start reading (${readings.start.effectiveKm} km). Check the dashboard and try again.`);
      }
      if (value - readings.start.effectiveKm > MAX_TRIP_KM) {
        throw fail(400, `That is more than ${MAX_TRIP_KM.toLocaleString("en-PH")} km since the start reading. Check the dashboard and try again.`);
      }
    }
    // lower than the vehicle's last figure: saved, but said — the dashboard may be right and the record wrong
    const lastKnown = km(trip.odometer);
    const warning = lastKnown && value < lastKnown
      ? `Lower than the last figure on record for this vehicle (${lastKnown} km). Saved; the Fleet team can check it.`
      : null;

    const [ins] = await conn.execute(
      `INSERT INTO trip_odometer_readings
         (company_id, branch_id, trip_ticket_id, vehicle_id, driver_id, kind, value_km, client_ref,
          photo_path, photo_mime, photo_size, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() - INTERVAL ? SECOND)`,
      [
        driver.companyId, Number(trip.branch_id), tripId, trip.vehicle_id, driver.driverId, kind, value, clientRef,
        file ? toRelative(file.path) : null, file ? file.mimetype : null, file ? file.size : null, ageS,
      ]
    );
    await advanceVehicleOdometer(conn, { vehicleId: trip.vehicle_id, companyId: driver.companyId, value });
    await conn.commit();
    const [[saved]] = await db.execute(`${SELECT_MINE} WHERE reading_id = ?`, [ins.insertId]);
    return { reading: shape(saved), duplicate: false, warning, branchId: Number(trip.branch_id) };
  } catch (e) {
    await conn.rollback();
    if (e?.code === "ER_DUP_ENTRY") {
      const [[winner]] = await db.execute(`${SELECT_MINE} WHERE driver_id = ? AND client_ref = ? LIMIT 1`, [driver.driverId, clientRef]);
      if (winner) return { reading: shape(winner), duplicate: true, warning: null };
      // a different reading for the same trip and kind got there first
      throw fail(409, "That reading is already recorded. The Fleet team can correct it if it is wrong.", { code: "odometer_recorded" });
    }
    throw e;
  } finally {
    conn.release();
  }
}

/* ---------------------------------------------------------------- */
/* The Fleet team                                                   */
/* ---------------------------------------------------------------- */

/** A trip's readings, for the office. */
export async function readingsForOffice({ companyId, tripId }) {
  const [[trip]] = await db.execute("SELECT trip_ticket_id FROM trip_tickets WHERE trip_ticket_id = ? AND company_id = ? LIMIT 1", [tripId, companyId]);
  if (!trip) return null;
  const readings = await readingsFor(db, tripId);
  return { ...readings, actualKm: actualKm(readings) };
}

/** The stored dashboard photo for one reading, or null. */
export async function photoForOffice({ companyId, id }) {
  const [[p]] = await db.execute(
    "SELECT photo_path AS path, photo_mime AS mime FROM trip_odometer_readings WHERE reading_id = ? AND company_id = ? LIMIT 1",
    [id, companyId]
  );
  return p?.path ? p : null;
}

/**
 * Fleet corrects a reading, with a reason. The driver's figure stays as it was
 * entered; the corrected one is what the distance is worked out from. Returns
 * { tripId, kind, from, to } for the audit entry.
 */
export async function correctReading({ companyId, id, userId, valueKm, reason }) {
  const value = readKm(valueKm);
  if (value == null) throw fail(400, "Enter the corrected reading in kilometres, as numbers only.");
  const why = String(reason || "").trim();
  if (why.length < MIN_REASON) throw fail(400, "Give the reason for the correction.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.execute(
      `SELECT reading_id, trip_ticket_id, vehicle_id, kind, value_km, corrected_value_km
         FROM trip_odometer_readings WHERE reading_id = ? AND company_id = ? FOR UPDATE`,
      [id, companyId]
    );
    if (!row) throw fail(404, "Reading not found.");
    const before = km(row.corrected_value_km ?? row.value_km);

    // the corrected pair must still make sense
    const readings = await readingsFor(conn, row.trip_ticket_id);
    const other = row.kind === "start" ? readings.end : readings.start;
    if (other) {
      const start = row.kind === "start" ? value : other.effectiveKm;
      const end = row.kind === "end" ? value : other.effectiveKm;
      if (end < start) throw fail(400, "With this correction the end reading would be lower than the start.");
      if (end - start > MAX_TRIP_KM) throw fail(400, `With this correction the trip would be more than ${MAX_TRIP_KM} km.`);
    }

    await conn.execute(
      `UPDATE trip_odometer_readings
          SET corrected_value_km = ?, corrected_by = ?, corrected_at = NOW(), correction_reason = ?
        WHERE reading_id = ?`,
      [value, userId, why.slice(0, 500), id]
    );
    await advanceVehicleOdometer(conn, { vehicleId: row.vehicle_id, companyId, value });
    await conn.commit();
    return { tripId: row.trip_ticket_id, kind: row.kind, from: before, to: value };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
