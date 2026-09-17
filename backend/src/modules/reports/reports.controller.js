/**
 * Reports, counted by the database.
 *
 * Every report screen used to pull whole tables to the browser and add them up
 * there — the fleet report asked for five thousand vehicles, five thousand
 * drivers and five thousand maintenance records on every load, and operations
 * asked for two thousand trips. That works on demo data and gets slower every
 * week a real operator uses it, until one day the page simply stops finishing.
 *
 * Counting belongs where the rows are. These handlers return only the figures
 * the screens draw, which is a few dozen numbers rather than a few thousand
 * records.
 *
 * Two scoping rules are inherited deliberately rather than invented here, so a
 * report and the list screen behind it can never disagree:
 *
 *   • vehicles, drivers and maintenance are scoped by company only, exactly as
 *     the Fleet screens scope them
 *   • trips and exceptions are scoped by company AND branch, exactly as the
 *     Operations screens scope them
 */
import db from "../../config/db.js";

/**
 * A vehicle's live status, overlaid with whether it is out on a run.
 *
 * Copied deliberately from vehicles.controller so the report and the Fleet
 * list count the same thing. If one changes, both must.
 */
const OPERATIONAL_STATUS_SQL = `
  CASE
    WHEN v.status = 'maintenance' THEN 'maintenance'
    WHEN v.status = 'inactive' THEN 'inactive'
    WHEN EXISTS (
      SELECT 1 FROM trip_assignments ta
      JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
      WHERE ta.vehicle_id = v.vehicle_id AND ta.is_current = TRUE
        AND tt.status IN ('assigned','accepted','released','in_transit')
    ) THEN 'on_trip'
    ELSE 'available'
  END`;

/** The words the Fleet screens already use for those states. */
const VEHICLE_LABEL = {
  available: "Available",
  on_trip: "On Trip",
  maintenance: "Maintenance",
  inactive: "Retired",
};

const MAINTENANCE_LABEL = {
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const titleCase = (s) =>
  String(s || "")
    .split("_")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

/**
 * A date range from the query string, or nothing.
 *
 * Only ever produces a fragment with placeholders; the values stay parameters.
 * A malformed date is dropped rather than rejected — a report with no filter is
 * a reasonable answer to a broken bookmark, where an error page is not.
 */
export function range(column, req) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const from = iso.test(req.query.from || "") ? req.query.from : null;
  const to = iso.test(req.query.to || "") ? req.query.to : null;

  let sql = "";
  const params = [];
  if (from) {
    sql += ` AND ${column} >= ?`;
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    sql += ` AND ${column} <= ?`;
    params.push(`${to} 23:59:59`);
  }
  return { sql, params, applied: Boolean(from || to), from, to };
}

/** [{key,label,value}] in the shape the report charts already expect. */
export const rows = (result, label = titleCase) =>
  result.map((r) => ({
    key: String(r.k ?? ""),
    label: label(r.k),
    value: Number(r.c),
  }));


/**
 * A money series for a bar chart. MySQL returns DECIMAL as a string and the
 * charts plot integers, so the rounding happens once here.
 */
export const money = (result, label = titleCase) =>
  result.map((r) => ({
    key: String(r.k ?? ""),
    label: label(r.k),
    value: Math.round(Number(r.c || 0)),
  }));
/* ---------------------------------------------------------------- */
/* Fleet                                                            */
/* ---------------------------------------------------------------- */

export async function fleetReport(req, res) {
  const { companyId } = req.context;
  const when = range("COALESCE(m.completed_date, m.scheduled_date, DATE(m.created_at))", req);

  const [
    [vehicleStatus],
    [vehicleTypes],
    [driverStatus],
    [licence],
    [maintenanceTypes],
    [maintenanceStatus],
    [maintenanceCost],
    [costByVehicle],
  ] = await Promise.all([
    db.execute(
      `SELECT ${OPERATIONAL_STATUS_SQL} AS k, COUNT(*) AS c
         FROM vehicles v WHERE v.company_id = ? GROUP BY k`,
      [companyId]
    ),
    db.execute(
      `SELECT v.vehicle_type AS k, COUNT(*) AS c
         FROM vehicles v WHERE v.company_id = ?
        GROUP BY v.vehicle_type ORDER BY c DESC`,
      [companyId]
    ),
    db.execute(
      `SELECT d.status AS k, COUNT(*) AS c
         FROM drivers d WHERE d.company_id = ? GROUP BY d.status`,
      [companyId]
    ),
    // NULL counts as valid, matching the Fleet screen: a driver with no expiry
    // recorded is a data gap, not an expired licence.
    db.execute(
      `SELECT
         SUM(CASE WHEN d.license_expiry IS NOT NULL
                   AND DATEDIFF(d.license_expiry, CURDATE()) < 0 THEN 1 ELSE 0 END) AS expired,
         SUM(CASE WHEN d.license_expiry IS NOT NULL
                   AND DATEDIFF(d.license_expiry, CURDATE()) BETWEEN 0 AND 30 THEN 1 ELSE 0 END) AS soon,
         SUM(CASE WHEN d.license_expiry IS NULL
                   OR DATEDIFF(d.license_expiry, CURDATE()) > 30 THEN 1 ELSE 0 END) AS valid,
         COUNT(*) AS total
       FROM drivers d WHERE d.company_id = ?`,
      [companyId]
    ),
    db.execute(
      `SELECT m.maintenance_type AS k, COUNT(*) AS c
         FROM vehicle_maintenance m
        WHERE m.company_id = ?${when.sql}
        GROUP BY m.maintenance_type ORDER BY c DESC LIMIT 8`,
      [companyId, ...when.params]
    ),
    db.execute(
      `SELECT m.status AS k, COUNT(*) AS c
         FROM vehicle_maintenance m
        WHERE m.company_id = ?${when.sql}
        GROUP BY m.status`,
      [companyId, ...when.params]
    ),
    db.execute(
      `SELECT COUNT(*) AS jobs,
              COALESCE(SUM(CASE WHEN m.status = 'completed' THEN m.cost ELSE 0 END), 0) AS spend
         FROM vehicle_maintenance m
        WHERE m.company_id = ?${when.sql}`,
      [companyId, ...when.params]
    ),
    db.execute(
      `SELECT COALESCE(v.plate_no, '—') AS k, COALESCE(SUM(m.cost), 0) AS c
         FROM vehicle_maintenance m
         LEFT JOIN vehicles v ON v.vehicle_id = m.vehicle_id
        WHERE m.company_id = ? AND m.status = 'completed' AND m.cost IS NOT NULL${when.sql}
        GROUP BY v.plate_no ORDER BY c DESC LIMIT 8`,
      [companyId, ...when.params]
    ),
  ]);

  const byStatus = Object.fromEntries(vehicleStatus.map((r) => [r.k, Number(r.c)]));
  const totalVehicles = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const active = totalVehicles - (byStatus.inactive || 0);
  const lic = licence[0] || {};

  res.json({
    success: true,
    data: {
      vehicles: {
        total: totalVehicles,
        availabilityPct: active ? Math.round(((byStatus.available || 0) / active) * 100) : 0,
        statusRows: rows(vehicleStatus, (k) => VEHICLE_LABEL[k] || titleCase(k)),
        typeRows: rows(vehicleTypes, (k) => k || "Unspecified"),
      },
      drivers: {
        total: Number(lic.total || 0),
        atRisk: Number(lic.expired || 0) + Number(lic.soon || 0),
        statusRows: rows(driverStatus),
        licenceRows: [
          { key: "valid", label: "Valid", value: Number(lic.valid || 0) },
          { key: "soon", label: "Expiring Soon", value: Number(lic.soon || 0) },
          { key: "expired", label: "Expired", value: Number(lic.expired || 0) },
        ],
      },
      maintenance: {
        count: Number(maintenanceCost[0]?.jobs || 0),
        totalCost: Number(maintenanceCost[0]?.spend || 0),
        typeRows: rows(maintenanceTypes, (k) => k || "Unspecified"),
        statusRows: rows(maintenanceStatus, (k) => MAINTENANCE_LABEL[k] || titleCase(k)),
        costRows: costByVehicle.map((r) => ({
          key: String(r.k),
          label: String(r.k),
          value: Math.round(Number(r.c)),
        })),
      },
      range: { from: when.from, to: when.to, applied: when.applied },
    },
  });
}

/* ---------------------------------------------------------------- */
/* Operations                                                       */
/* ---------------------------------------------------------------- */

export async function operationsReport(req, res) {
  const { companyId, branchId } = req.context;
  const trips = range("COALESCE(tt.scheduled_departure, tt.created_at)", req);
  const exceptions = range("oe.detected_at", req);
  const scope = [companyId, branchId];

  const [
    [status],
    [timing],
    [topRoutes],
    [priority],
    [exceptionSeverity],
    [exceptionStatus],
    [exceptionTypes],
    [exceptionResolution],
  ] = await Promise.all([
    db.execute(
      `SELECT tt.status AS k, COUNT(*) AS c
         FROM trip_tickets tt
        WHERE tt.company_id = ? AND tt.branch_id = ?${trips.sql}
        GROUP BY tt.status`,
      [...scope, ...trips.params]
    ),
    // On-time can only be judged where both times exist; counting a trip with
    // no recorded arrival as late would punish missing paperwork, not lateness.
    db.execute(
      `SELECT
         SUM(CASE WHEN tt.actual_arrival IS NOT NULL AND tt.scheduled_arrival IS NOT NULL
                  THEN 1 ELSE 0 END) AS judged,
         SUM(CASE WHEN tt.actual_arrival IS NOT NULL AND tt.scheduled_arrival IS NOT NULL
                   AND tt.actual_arrival <= tt.scheduled_arrival THEN 1 ELSE 0 END) AS onTime,
         AVG(CASE WHEN tt.scheduled_departure IS NOT NULL AND tt.scheduled_arrival IS NOT NULL
                  THEN TIMESTAMPDIFF(MINUTE, tt.scheduled_departure, tt.scheduled_arrival) END) AS avgMinutes,
         COUNT(*) AS total
       FROM trip_tickets tt
      WHERE tt.company_id = ? AND tt.branch_id = ?${trips.sql}`,
      [...scope, ...trips.params]
    ),
    db.execute(
      `SELECT CONCAT(tt.origin, ' → ', tt.destination) AS k, COUNT(*) AS c
         FROM trip_tickets tt
        WHERE tt.company_id = ? AND tt.branch_id = ?${trips.sql}
        GROUP BY tt.origin, tt.destination ORDER BY c DESC LIMIT 6`,
      [...scope, ...trips.params]
    ),
    db.execute(
      `SELECT tt.priority AS k, COUNT(*) AS c
         FROM trip_tickets tt
        WHERE tt.company_id = ? AND tt.branch_id = ?${trips.sql}
        GROUP BY tt.priority`,
      [...scope, ...trips.params]
    ),
    db.execute(
      `SELECT oe.severity AS k, COUNT(*) AS c
         FROM operational_exceptions oe
        WHERE oe.company_id = ? AND oe.branch_id = ?${exceptions.sql}
        GROUP BY oe.severity`,
      [...scope, ...exceptions.params]
    ),
    db.execute(
      `SELECT oe.status AS k, COUNT(*) AS c
         FROM operational_exceptions oe
        WHERE oe.company_id = ? AND oe.branch_id = ?${exceptions.sql}
        GROUP BY oe.status`,
      [...scope, ...exceptions.params]
    ),
    db.execute(
      `SELECT oe.exception_type AS k, COUNT(*) AS c
         FROM operational_exceptions oe
        WHERE oe.company_id = ? AND oe.branch_id = ?${exceptions.sql}
        GROUP BY oe.exception_type ORDER BY c DESC LIMIT 6`,
      [...scope, ...exceptions.params]
    ),
    // Only exceptions that were actually resolved can say how long resolving
    // takes. An open one has no duration yet, and counting it as zero would
    // make a backlog look like excellent response times.
    db.execute(
      `SELECT AVG(TIMESTAMPDIFF(MINUTE, oe.detected_at, oe.resolved_at)) AS avgMinutes
         FROM operational_exceptions oe
        WHERE oe.company_id = ? AND oe.branch_id = ?
          AND oe.resolved_at IS NOT NULL${exceptions.sql}`,
      [...scope, ...exceptions.params]
    ),
  ]);

  const t = timing[0] || {};
  const judged = Number(t.judged || 0);

  res.json({
    success: true,
    data: {
      trips: {
        total: Number(t.total || 0),
        // null rather than 0 when nothing can be judged: "no data" and "none
        // arrived on time" are different answers and must not look alike.
        onTimePct: judged ? Math.round((Number(t.onTime || 0) / judged) * 100) : null,
        onTimeJudged: judged,
        avgDurationHours: t.avgMinutes != null ? Number(t.avgMinutes) / 60 : null,
        statusRows: rows(status),
        priorityRows: rows(priority),
        topRoutes: topRoutes.map((r) => ({
          key: String(r.k),
          label: String(r.k),
          value: Number(r.c),
        })),
      },
      exceptions: {
        total: exceptionStatus.reduce((sum, r) => sum + Number(r.c), 0),
        open: Number(exceptionStatus.find((r) => r.k === "open")?.c || 0),
        severityRows: rows(exceptionSeverity),
        statusRows: rows(exceptionStatus),
        typeRows: rows(exceptionTypes),
        avgResolutionHours:
          exceptionResolution[0]?.avgMinutes != null
            ? Number(exceptionResolution[0].avgMinutes) / 60
            : null,
      },
      range: { from: trips.from, to: trips.to, applied: trips.applied },
    },
  });
}
