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

export async function getAllTrips(params = {}) {
  const query = new URLSearchParams();
  if (params.status && params.status !== "all") query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  if (params.page) query.set("page", params.page);
  query.set("limit", params.limit || 200);

  const res = await get(`/operations/trips?${query.toString()}`);
  return (res.data || []).map(mapTrip);
}

export async function getTripById(id) {
  const res = await get(`/operations/trips/${id}`);
  const trip = mapTrip(res.data);
  trip.history = (res.data?.history || []).map(mapHistory);
  trip.stops = res.data?.stops || [];
  return trip;
}

export async function getTripStats() {
  const trips = await getAllTrips({ limit: 1000 });
  const has = (...s) => trips.filter((t) => s.includes(t.status)).length;
  return {
    total: trips.length,
    draft: has("draft"),
    pending: has("validated", "for_validation", "for_approval"),
    approved: has("approved", "assigned", "accepted", "released"),
    inTransit: has("in_transit"),
    delivered: has("delivered"),
    closed: has("operationally_closed"),
    rejected: has("rejected"),
    cancelled: has("cancelled"),
  };
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
