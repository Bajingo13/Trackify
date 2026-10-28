import { get, post, patch } from "../apiClient";

/* ---- adapters: API (snake_case) -> shape the pages expect (camelCase) ---- */

/** route_geometry arrives parsed (mysql2 JSON) but tolerate a string form too. */
function geoJsonOrNull(v) {
  if (!v) return null;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
  return Array.isArray(v.coordinates) ? v : null;
}

/**
 * The structured address on one end of a trip, or null when none was recorded.
 *
 * Returns null rather than an object of nulls so a caller can ask "is there an
 * address here" without inspecting six fields.
 */
function addressOf(row, end) {
  const parts = {
    houseNumber: row[`${end}_house_no`] || null,
    street: row[`${end}_street`] || null,
    barangay: row[`${end}_barangay`] || null,
    city: row[`${end}_city`] || null,
    province: row[`${end}_province`] || null,
    postcode: row[`${end}_postcode`] || null,
  };
  return Object.values(parts).some(Boolean) ? parts : null;
}

function mapTrip(row) {
  if (!row) return row;
  return {
    id: row.trip_ticket_id,
    ticketNo: row.ticket_no,
    customerId: row.customer_id ?? null,
    customer: row.customer_name || "—",
    purpose: row.purpose,
    origin: row.origin,
    destination: row.destination,
    originCoord: row.origin_lat != null ? { lat: Number(row.origin_lat), lng: Number(row.origin_lng) } : null,
    destCoord: row.destination_lat != null ? { lat: Number(row.destination_lat), lng: Number(row.destination_lng) } : null,
    // The parts behind the pin. Null on a trip typed by hand or created before
    // these columns existed, which is why every reader must treat them as
    // optional rather than assume a barangay is present.
    originAddress: addressOf(row, "origin"),
    destAddress: addressOf(row, "destination"),
    // The barangays this trip stops in, pipe-separated by the server because a
    // barangay name can contain a comma. On a multi-drop run most deliveries
    // happen at a stop, so a list that knows only the two ends hides most of
    // the work done.
    stopBarangays: String(row.stop_barangays || "").split("|").filter(Boolean),
    routeKm: row.route_distance_km != null ? Number(row.route_distance_km) : null,
    routeMin: row.route_duration_min != null ? Number(row.route_duration_min) : null,
    routeGeom: geoJsonOrNull(row.route_geometry),
    scheduledDeparture: row.scheduled_departure,
    scheduledArrival: row.scheduled_arrival,
    actualDeparture: row.actual_departure,
    actualArrival: row.actual_arrival,
    priority: row.priority,
    status: row.status,
    dispatchMode: row.dispatch_mode,
    driver: row.driver_name && row.driver_name.trim() !== "" ? row.driver_name : null,
    vehicle: row.plate_no || null,
    vehicleType: row.vehicle_type || null,
    vehicleCapacityKg: row.vehicle_capacity != null ? Number(row.vehicle_capacity) : null,
    cargoDescription: row.cargo_description,
    cargoQuantity: row.cargo_quantity,
    cargoWeight: row.cargo_weight,
    specialHandling: row.special_handling,
    dispatchNotes: row.dispatch_notes,
    specialInstructions: row.special_instructions,
    notes: row.notes,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    rejectionReason: row.rejection_reason,
    intermediateStops: Array.isArray(row.stops)
      ? row.stops.map((s) => s.location_name)
      : [],
    stops: Array.isArray(row.stops)
      ? row.stops.map((s) => ({
          id: s.stop_id,
          order: s.stop_order,
          label: s.location_name,
          lat: s.latitude != null ? Number(s.latitude) : null,
          lng: s.longitude != null ? Number(s.longitude) : null,
          plannedArrival: s.planned_arrival || null,
          // set once the driver marks the stop reached
          arrivedAt: s.actual_arrival || null,
          arrivedLat: s.arrived_lat != null ? Number(s.arrived_lat) : null,
          arrivedLng: s.arrived_lng != null ? Number(s.arrived_lng) : null,
          arrivalNote: s.arrival_note || null,
        }))
      : [],
    pod: row.pod
      ? {
          receivedBy: row.pod.received_by,
          note: row.pod.note || null,
          capturedAt: row.pod.captured_at,
          lat: row.pod.captured_lat != null ? Number(row.pod.captured_lat) : null,
          lng: row.pod.captured_lng != null ? Number(row.pod.captured_lng) : null,
          hasPhoto: !!Number(row.pod.has_photo),
          driver: row.pod.driver_name || null,
          // the receiver's signature (migration 062), or why there is none
          hasSignature: !!Number(row.pod.has_signature),
          signedAt: row.pod.signed_at || null,
          unsignedReason: row.pod.unsigned_reason || null,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapHistory(h) {
  return {
    action: h.action,
    details: h.remarks || `${h.from_status ?? "—"} → ${h.to_status}`,
    timestamp: h.created_at,
    user: h.changed_by_name || "System",
  };
}

/* ---- queries ---- */

/** The most rows the server returns for one request. */
export const MAX_TRIPS_PER_REQUEST = 100;

function tripQuery(params = {}) {
  const query = new URLSearchParams();
  // status is one value or a comma list ("approved,assigned"); "all" means none.
  if (params.status && params.status !== "all") query.set("status", params.status);
  if (params.priority && params.priority !== "all") query.set("priority", params.priority);
  if (params.search?.trim()) query.set("search", params.search.trim());
  // Matched exactly on the server so the barangay indexes are used, which is why
  // this is a whole barangay name rather than a search term.
  if (params.barangay && params.barangay !== "all") query.set("barangay", params.barangay.trim());
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.page) query.set("page", String(params.page));
  // Asked for in the range the server allows, so what is requested is what is
  // returned. Asking for 1000 used to be answered with 100 and no warning.
  const limit = Math.min(Math.max(Math.trunc(Number(params.limit)) || 20, 1), MAX_TRIPS_PER_REQUEST);
  query.set("limit", String(limit));
  return query;
}

/**
 * One page of trips and what the server says about the whole result: filtering,
 * searching and paging all happen in the database.
 *
 * @returns {{ rows: object[], pagination: { page, limit, total, totalPages } }}
 */
export async function getTripsPage(params = {}) {
  const res = await get(`/operations/trips?${tripQuery(params).toString()}`, { signal: params.signal });
  const p = res.pagination || {};
  const rows = (res.data || []).map(mapTrip);
  return {
    rows,
    pagination: {
      page: Number(p.page) || 1,
      limit: Number(p.limit) || rows.length,
      total: Number(p.total) || 0,
      totalPages: Number(p.totalPages) || 0,
    },
  };
}

/**
 * Up to one request's worth (100) of the newest matching trips, as a plain array.
 *
 * For pick-lists that only need recent trips. It is NOT "all trips": anything
 * that must see every match should use getTripsPage and follow the pages, or
 * getTripSummary for counts.
 */
export async function getAllTrips(params = {}) {
  return (await getTripsPage(params)).rows;
}

/**
 * Every matching trip, by following the pages, up to `max` (default 5,000).
 * Used by the CSV export, which must contain what the filters match and not just
 * what is on screen. `onProgress(done, total)` is called after each page.
 *
 * @returns {{ rows: object[], total: number, truncated: boolean }}
 */
export async function getAllTripPages(params = {}, { max = 5000, onProgress, signal } = {}) {
  const rows = [];
  let total = 0;
  for (let page = 1; ; page += 1) {
    const result = await getTripsPage({ ...params, page, limit: MAX_TRIPS_PER_REQUEST, signal });
    total = result.pagination.total;
    rows.push(...result.rows);
    onProgress?.(Math.min(rows.length, total), total);
    if (!result.rows.length || rows.length >= total || page >= result.pagination.totalPages) break;
    if (rows.length >= max) break;
  }
  return { rows: rows.slice(0, max), total, truncated: total > max };
}

/**
 * Find a trip by what someone types — the Ctrl+K palette. Its own endpoint
 * rather than getAllTrips: the list asks the server for the whole trip with
 * its driver, vehicle and stops and a total count, which a five-row dropdown
 * never shows and which cost about a second per search on a large company.
 */
export async function searchTrips(term, { limit = 5, signal } = {}) {
  const query = new URLSearchParams({ q: term, limit: String(limit) });
  const res = await get(`/operations/trips/search?${query.toString()}`, { signal });
  return (res.data || []).map((row) => ({
    id: row.trip_ticket_id,
    ticketNo: row.ticket_no,
    customer: row.customer_name || "—",
    origin: row.origin,
    destination: row.destination,
  }));
}

export async function getTripById(id) {
  const res = await get(`/operations/trips/${id}`);
  const trip = mapTrip(res.data);
  trip.history = (res.data?.history || []).map(mapHistory);
  trip.stops = res.data?.stops || [];
  return trip;
}

/**
 * Turn the server's per-status counts into the groups the screens show. Pure, so
 * it is tested without a server.
 */
export function groupStatusCounts(counts = {}, total = 0) {
  const n = (...statuses) => statuses.reduce((sum, s) => sum + (Number(counts[s]) || 0), 0);
  return {
    total: Number(total) || 0,
    draft: n("draft"),
    pending: n("validated", "for_validation", "for_approval"),
    approved: n("approved", "assigned", "accepted", "released"),
    inTransit: n("in_transit"),
    delivered: n("delivered"),
    closed: n("operationally_closed"),
    rejected: n("rejected"),
    cancelled: n("cancelled"),
  };
}

/**
 * The counts a trips screen needs, counted by the database: per-status totals
 * and the barangays that appear. One small request, whatever the number of trips
 * (it used to download them, and counted at most 100).
 *
 * @returns {{ counts: Record<string, number>, total: number, barangays: string[] }}
 */
export async function getTripSummary({ signal } = {}) {
  const res = await get("/operations/trips/summary", { signal });
  const d = res.data || {};
  return {
    counts: d.counts || {},
    total: Number(d.total) || 0,
    barangays: Array.isArray(d.barangays) ? d.barangays : [],
  };
}

export async function getTripStats() {
  const { counts, total } = await getTripSummary();
  return groupStatusCounts(counts, total);
}

export async function getTripActivities(tripId) {
  const trip = await getTripById(tripId);
  return trip.history || [];
}

/* ---- mutations ---- */

export async function createTrip(data) {
  return post("/operations/trips", data);
}

export async function updateTrip(id, data) {
  return patch(`/operations/trips/${id}`, data);
}

export async function submitTrip(id) {
  return post(`/operations/trips/${id}/submit`);
}

/* ---- workflow transitions ---- */
export const validateTrip = (id, body) => post(`/operations/trips/${id}/validate`, body || {});
export const approveTrip = (id, body) => post(`/operations/trips/${id}/approve`, body || {});
export const rejectTrip = (id, body) => post(`/operations/trips/${id}/reject`, body || {});
export const releaseTrip = (id) => post(`/operations/trips/${id}/release`, {});
export const startTrip = (id) => post(`/operations/trips/${id}/start`, {});
export const deliverTrip = (id, body) => post(`/operations/trips/${id}/deliver`, body || {});
export const closeTrip = (id) => post(`/operations/trips/${id}/close`, {});
export const cancelTrip = (id, body) => post(`/operations/trips/${id}/cancel`, body || {});

/* ---- assignment (dispatch) ---- */
export const assignTrip = (id, body) => post(`/operations/dispatch/trips/${id}/assign`, body);

export async function getAssignableResources() {
  const res = await get("/fleet/availability");
  const pick = (rows) => (rows || []).filter((r) => r.availability === "available");
  return {
    drivers: pick(res.data?.drivers).map((d) => ({
      id: d.driver_id,
      label: `${d.first_name} ${d.last_name}`,
      // the employee number is how a driver is identified on the roster, on
      // the radio, and at the driver-app sign-in — a licence number is not
      sub: [d.employee_no, d.license_no].filter(Boolean).join(" · "),
    })),
    vehicles: pick(res.data?.vehicles).map((v) => ({
      id: v.vehicle_id,
      label: v.plate_no,
      sub: [v.vehicle_type, v.brand, v.model].filter(Boolean).join(" · "),
    })),
  };
}
