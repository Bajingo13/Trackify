import { get, post, patch } from "../apiClient";

export const VEHICLE_STATUSES = ["Available", "On Trip", "Maintenance", "Inactive"];
export const VEHICLE_TYPES = [
  "Closed Van", "Box Truck", "Wing Van", "Furniture Truck", "Refrigerated Van",
  "Flatbed Truck", "Tractor Trailer", "Container Truck", "Tanker", "Pickup",
  "Trailer", "Motorcycle",
];

const OP_LABEL = { available: "Available", on_trip: "On Trip", maintenance: "Maintenance", inactive: "Retired" };

function mapVehicle(v) {
  return {
    id: v.vehicle_id,
    plateNo: v.plate_no,
    type: v.vehicle_type,
    brand: v.brand || "",
    model: v.model || "",
    year: v.year || "",
    color: v.color || "",
    capacityKg: v.capacity != null ? Number(v.capacity) : null,
    odometerReading: v.odometer != null ? Number(v.odometer) : 0,
    homeBranch: v.home_branch || "",
    homeBranchId: v.home_branch_id || null,
    currentLocation: v.home_branch || "—",
    registrationExpiry: v.registration_expiry || null,
    insuranceExpiry: v.insurance_expiry || null,
    serviceIntervalKm: v.service_interval_km != null ? Number(v.service_interval_km) : null,
    lastServiceOdometer: v.last_service_odometer != null ? Number(v.last_service_odometer) : 0,
    kmToService: v.km_to_service != null ? Number(v.km_to_service) : null,
    serviceStatus: serviceStatusOf(v.km_to_service),
    status: OP_LABEL[v.operational_status] || OP_LABEL[v.status] || "Available",
    rawStatus: v.status,
    currentTrip: v.current_trip_no || null,
    assignedDriverId: null,
    nextMaintenance: v.next_maintenance || null,
    createdAt: v.created_at,
  };
}

/** null = no interval set · "overdue" · "due-soon" (<500 km) · "ok" */
export function serviceStatusOf(kmToService) {
  if (kmToService == null) return null;
  const km = Number(kmToService);
  if (km <= 0) return "overdue";
  if (km < 500) return "due-soon";
  return "ok";
}

/** API status filter from the UI label. */
function toApiStatus(label) {
  if (!label) return "";
  const m = { Available: "active", "On Trip": "active", Maintenance: "maintenance", Inactive: "inactive" };
  return m[label] || label.toLowerCase();
}

function toPayload(d) {
  return {
    plateNo: d.plateNo, vehicleType: d.type ?? d.vehicleType,
    brand: d.brand, model: d.model, year: d.year, color: d.color,
    capacity: d.capacityKg ?? d.capacity, odometer: d.odometerReading ?? d.odometer,
    registrationExpiry: d.registrationExpiry, insuranceExpiry: d.insuranceExpiry,
    homeBranchId: d.homeBranchId,
    serviceIntervalKm: d.serviceIntervalKm === "" ? null : d.serviceIntervalKm,
    lastServiceOdometer: d.lastServiceOdometer === "" ? undefined : d.lastServiceOdometer,
  };
}

export async function getAllVehicles(filters = {}) {
  const q = new URLSearchParams();
  if (filters.search) q.set("search", filters.search);
  const res = await get(`/fleet/vehicles${q.toString() ? `?${q}` : ""}`);
  let rows = (res.data || []).map(mapVehicle);

  // operational status ("On Trip" etc.) is derived, so filter it here
  if (filters.status) rows = rows.filter((r) => r.status === filters.status);
  if (filters.type) rows = rows.filter((r) => r.type === filters.type);

  // client-side pagination to match the existing page contract
  const page = filters.page || 1;
  const limit = filters.limit || 10;
  const total = rows.length;
  return { data: rows.slice((page - 1) * limit, page * limit), total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export async function getVehicleById(id) {
  const res = await get(`/fleet/vehicles/${id}`);
  return mapVehicle(res.data);
}

export async function createVehicle(data) {
  return post("/fleet/vehicles", toPayload(data));
}

export async function updateVehicle(id, data) {
  return patch(`/fleet/vehicles/${id}`, toPayload(data));
}

export async function updateOdometer(id, newReading) {
  try {
    await patch(`/fleet/vehicles/${id}`, { odometer: Number(newReading) });
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/** No hard delete — a vehicle is retired (status → inactive). */
export async function deleteVehicle(id) {
  try {
    await patch(`/fleet/vehicles/${id}`, { status: "inactive" });
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

export async function getVehicleStats() {
  const res = await get("/fleet/vehicles/stats");
  const s = res.data || {};
  return {
    total: s.total || 0,
    available: s.available || 0,
    assigned: 0,
    onTrip: s.onTrip || 0,
    reserved: 0,
    maintenance: s.maintenance || 0,
    unavailable: s.inactive || 0,
    serviceOverdue: s.serviceOverdue || 0,
    serviceDueSoon: s.serviceDueSoon || 0,
  };
}

export async function getAvailabilityData() {
  const res = await get("/fleet/availability");
  return (res.data?.vehicles || []).map((v) => ({
    id: v.vehicle_id,
    plateNo: v.plate_no,
    type: v.vehicle_type,
    brand: v.brand || "",
    model: v.model || "",
    assignedDriverId: null,
    currentLocation: v.home_branch || "—",
    odometerReading: v.odometer != null ? Number(v.odometer) : 0,
    status: OP_LABEL[v.availability] || "Available",
    currentAssignment: v.current_trip_no || null,
    nextMaintenance: v.next_maintenance || null,
    nextMaintenanceOdometer: null,
  }));
}
