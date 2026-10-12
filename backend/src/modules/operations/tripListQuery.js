/**
 * Turns the query string of GET /operations/trips into a validated filter set
 * and the SQL condition that applies it.
 *
 * Why this is its own file: the list endpoint runs two statements — the page of
 * rows and a count of everything that matches — and both must apply exactly the
 * same conditions or the page footer ("1–20 of 134") disagrees with the rows.
 * Building the condition once, here, makes that impossible to get wrong, and it
 * can be tested without a database.
 *
 * Nothing from the request is ever put into the SQL text. Every value travels as
 * a bound parameter; the only text that is interpolated is a fixed fragment
 * chosen by this code, and the page size and offset, which are validated
 * integers.
 */
import { containsPattern } from "../../shared/likePattern.js";

/** The statuses a trip can have (the trip_tickets.status enum). */
export const TRIP_STATUSES = [
  "draft", "validated", "for_validation", "for_approval", "approved", "rejected",
  "assigned", "accepted", "released", "in_transit", "delivered", "returned",
  "operationally_closed", "cancelled",
];

/** The trip_tickets.priority enum. */
export const TRIP_PRIORITIES = ["low", "normal", "high", "critical"];

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
/** No real list has this many pages (1,000,000 x 100 rows); it only keeps the OFFSET a printable integer. */
export const MAX_PAGE = 1_000_000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const bad = (message) => Object.assign(new Error(message), { status: 400 });

const text = (value) => (Array.isArray(value) ? "" : String(value ?? "")).trim();

/** A real calendar date in YYYY-MM-DD form ("2026-02-30" is not one). */
function dateOnly(value, label) {
  const v = text(value);
  if (!v) return null;
  const valid = DATE_ONLY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
    && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  if (!valid) throw bad(`${label} must be a date written YYYY-MM-DD.`);
  return v;
}

/**
 * Validate and normalise the query string. Throws a 400 for a value that cannot
 * be right, rather than quietly returning an empty list that looks like "no
 * trips" to the person looking at it.
 */
export function parseTripListQuery(query = {}) {
  // "status=in_transit" or "status=approved,assigned,released". "all" and empty
  // mean no filter.
  const rawStatus = text(query.status);
  const statuses = rawStatus && rawStatus !== "all"
    ? [...new Set(rawStatus.split(",").map((s) => s.trim()).filter(Boolean))]
    : [];
  for (const s of statuses) {
    if (!TRIP_STATUSES.includes(s)) throw bad(`"${s}" is not a trip status.`);
  }

  const priority = text(query.priority);
  if (priority && priority !== "all" && !TRIP_PRIORITIES.includes(priority)) {
    throw bad(`"${priority}" is not a trip priority.`);
  }

  const from = dateOnly(query.from, "from");
  const to = dateOnly(query.to, "to");
  if (from && to && from > to) throw bad("from must not be later than to.");

  const pageSize = Math.min(Math.max(Math.trunc(Number(query.limit)) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  // The page becomes an OFFSET written into the SQL text. Number("Infinity"),
  // Number("1e400") and Number("1e20") are all "valid" numbers, and the last prints
  // as 2e+21 in a template string, which MySQL rejects: a malformed URL became a
  // 500. Anything that is not a finite integer is page 1, and a real but absurd
  // page is held at a ceiling, where it simply answers with an empty page.
  const requested = Math.trunc(Number(query.page));
  const page = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_PAGE) : 1;

  return {
    statuses,
    priority: priority && priority !== "all" ? priority : "",
    barangay: text(query.barangay),
    search: text(query.search),
    from,
    to,
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

/**
 * The WHERE condition for a parsed filter set, scoped to one company and branch.
 *
 * `needsAssignment` says whether the condition mentions the driver or vehicle
 * (only the free-text search does). The count query can then skip those three
 * joins entirely for a plain status or date filter, which is most of the time.
 */
export function buildTripWhere(filters, { companyId, branchId }) {
  const clauses = ["tt.company_id = ?", "tt.branch_id = ?"];
  const params = [companyId, branchId];
  let needsCustomer = false;
  let needsAssignment = false;

  if (filters.statuses.length === 1) {
    clauses.push("tt.status = ?");
    params.push(filters.statuses[0]);
  } else if (filters.statuses.length > 1) {
    clauses.push(`tt.status IN (${filters.statuses.map(() => "?").join(", ")})`);
    params.push(...filters.statuses);
  }

  if (filters.priority) {
    clauses.push("tt.priority = ?");
    params.push(filters.priority);
  }

  // Compared on the full datetime so an index on it could be used, and so a trip
  // leaving at 23:30 on the "to" day is included: "to" means the end of that day.
  if (filters.from) {
    clauses.push("tt.scheduled_departure >= ?");
    params.push(`${filters.from} 00:00:00`);
  }
  if (filters.to) {
    clauses.push("tt.scheduled_departure <= ?");
    params.push(`${filters.to} 23:59:59`);
  }

  /*
   * Barangay, matched exactly (not LIKE) so the (company_id, barangay) indexes
   * are used. Stops count as well as the two ends: on a multi-drop run most of
   * the work happens at a stop. EXISTS rather than a join, so a trip with three
   * stops in the barangay still counts once.
   */
  if (filters.barangay) {
    clauses.push(`(
      tt.origin_barangay = ?
      OR tt.destination_barangay = ?
      OR EXISTS (
        SELECT 1 FROM trip_stops ts
         WHERE ts.trip_ticket_id = tt.trip_ticket_id AND ts.stop_barangay = ?
      )
    )`);
    params.push(filters.barangay, filters.barangay, filters.barangay);
  }

  if (filters.search) {
    needsCustomer = true;
    needsAssignment = true;
    const like = containsPattern(filters.search);
    clauses.push(`(
      tt.ticket_no LIKE ? OR tt.origin LIKE ? OR tt.destination LIKE ? OR tt.purpose LIKE ?
      OR c.customer_name LIKE ?
      OR CONCAT(d.first_name, ' ', d.last_name) LIKE ?
      OR v.plate_no LIKE ?
    )`);
    params.push(like, like, like, like, like, like, like);
  }

  return { sql: clauses.join(" AND "), params, needsCustomer, needsAssignment };
}

/** The joins, as fixed fragments. Shared so the list and the count cannot drift. */
export const CUSTOMER_JOIN = `
    LEFT JOIN customers c ON c.customer_id = tt.customer_id`;

export const ASSIGNMENT_JOINS = `
    LEFT JOIN trip_assignments ta
      ON ta.trip_ticket_id = tt.trip_ticket_id AND ta.is_current = TRUE
    LEFT JOIN drivers d ON d.driver_id = ta.driver_id
    LEFT JOIN vehicles v ON v.vehicle_id = ta.vehicle_id`;
