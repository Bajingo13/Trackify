import { get, post, patch } from "../apiClient";

export const MAINTENANCE_TYPES = [
  "Oil Change", "Brake Inspection", "Tire Replacement", "Engine Service",
  "Battery Check", "General Inspection", "Preventive Maintenance", "Corrective Maintenance", "Other",
];
export const MAINTENANCE_STATUSES = ["Scheduled", "In Progress", "Completed", "Cancelled"];

const STATUS_LABEL = { scheduled: "Scheduled", in_progress: "In Progress", completed: "Completed", cancelled: "Cancelled" };
const STATUS_API = { Scheduled: "scheduled", "In Progress": "in_progress", Completed: "completed", Cancelled: "cancelled" };

function mapRecord(m) {
  return {
    id: m.maintenance_id,
    vehicleId: m.vehicle_id,
    vehiclePlate: m.plate_no,
    type: m.maintenance_type,
    serviceDate: m.scheduled_date || m.completed_date || null,
    completedDate: m.completed_date || null,
    odometerAtService: m.odometer_reading != null ? Number(m.odometer_reading) : null,
    technician: m.vendor || "",
    cost: m.cost != null ? Number(m.cost) : null,
    findings: m.description || "",
    notes: m.notes || "",
    status: STATUS_LABEL[m.status] || m.status,
    createdAt: m.created_at,
  };
}

function toPayload(f) {
  return {
    vehicleId: f.vehicleId ? Number(f.vehicleId) : undefined,
    maintenanceType: f.type ?? f.maintenanceType,
    description: f.findings ?? f.description,
    scheduledDate: f.serviceDate ?? f.scheduledDate,
    completedDate: f.completedDate,
    odometerReading: f.odometerAtService ?? f.odometerReading,
    cost: f.cost,
    vendor: f.technician ?? f.vendor,
    notes: f.notes,
  };
}

export async function getAllMaintenance(filters = {}) {
  const q = new URLSearchParams();
  if (filters.search) q.set("search", filters.search);
  if (filters.status) q.set("status", STATUS_API[filters.status] || "");
  if (filters.vehicleId) q.set("vehicleId", filters.vehicleId);
  const res = await get(`/fleet/maintenance${q.toString() ? `?${q}` : ""}`);
  const rows = (res.data || []).map(mapRecord);
  const page = filters.page || 1;
  const limit = filters.limit || 10;
  const total = rows.length;
  return { data: rows.slice((page - 1) * limit, page * limit), total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export async function createMaintenance(data) {
  return post("/fleet/maintenance", toPayload(data));
}

export async function updateMaintenance(id, data) {
  return patch(`/fleet/maintenance/${id}`, toPayload(data));
}

export async function completeMaintenance(id, { cost, findings } = {}) {
  return patch(`/fleet/maintenance/${id}`, { status: "completed", cost, description: findings });
}

export async function deleteMaintenance(id) {
  try {
    await patch(`/fleet/maintenance/${id}`, { status: "cancelled" });
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

export async function getMaintenanceStats() {
  const res = await get("/fleet/maintenance/stats");
  const s = res.data || {};
  return {
    total: s.total || 0,
    scheduled: s.scheduled || 0,
    overdue: s.dueSoon || 0,
    inProgress: s.inProgress || 0,
    completed: s.completed || 0,
  };
}
