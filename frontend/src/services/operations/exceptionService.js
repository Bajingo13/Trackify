import { get, post } from "../apiClient";

const exceptionTypes = {
  trip_delay: "Trip Delay",
  route_deviation: "Route Deviation",
  gps_offline: "GPS Offline",
  vehicle_breakdown: "Vehicle Breakdown",
  driver_declined: "Driver Declined",
  failed_delivery: "Failed Delivery",
  cargo_shortage: "Cargo Shortage",
  cargo_damage: "Cargo Damage",
  missing_pod: "Missing POD",
  schedule_conflict: "Schedule Conflict",
  vehicle_maintenance_block: "Vehicle Maintenance Block",
  driver_license_issue: "Driver License Issue",
};

function mapException(row) {
  if (!row) return row;

  const coordinates =
    row.latitude != null && row.longitude != null
      ? `${Number(row.latitude).toFixed(4)}, ${Number(row.longitude).toFixed(4)}`
      : null;

  return {
    id: row.exception_id,
    tripTicketId: row.trip_ticket_id ?? null,
    tripTicket: row.ticket_no || null,
    type: row.exception_type,
    severity: row.severity,
    title: row.title,
    description: row.description || "No description provided.",
    location:
      coordinates ||
      (row.origin && row.destination ? `${row.origin} → ${row.destination}` : "Not recorded"),
    driver: row.driver_name?.trim() || null,
    vehicle: row.plate_no || null,
    status: row.status,
    detectedAt: row.detected_at,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
    resolutionNotes: row.resolution_notes,
  };
}

export async function getAllExceptions(filters = {}) {
  const query = new URLSearchParams();
  if (filters.status && filters.status !== "all") query.set("status", filters.status);
  if (filters.severity && filters.severity !== "all") query.set("severity", filters.severity);
  if (filters.type) query.set("type", filters.type);

  const suffix = query.size ? `?${query.toString()}` : "";
  const response = await get(`/operations/exceptions${suffix}`);
  return (response.data || []).map(mapException);
}

export async function createException(payload) {
  return post("/operations/exceptions", payload);
}

export async function acknowledgeException(id) {
  return post(`/operations/exceptions/${id}/acknowledge`);
}

export async function resolveException(id, resolutionNotes) {
  return post(`/operations/exceptions/${id}/resolve`, { resolutionNotes });
}

export function getExceptionStats(exceptions = []) {
  return {
    total: exceptions.length,
    open: exceptions.filter((item) => item.status === "open").length,
    acknowledged: exceptions.filter((item) => item.status === "acknowledged").length,
    resolved: exceptions.filter((item) => item.status === "resolved").length,
    critical: exceptions.filter((item) => item.severity === "critical").length,
    warning: exceptions.filter((item) => item.severity === "warning").length,
    info: exceptions.filter((item) => item.severity === "info").length,
  };
}

export { exceptionTypes };
