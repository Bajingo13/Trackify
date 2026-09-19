import { get, post, patch, del, postForm, getDataUrl } from "../apiClient";

/**
 * The paperwork behind a job. A maintenance record carries a cost and a vendor;
 * these are what prove them — the parts invoice, the labour receipt, the
 * warranty slip. Several per job is the normal case, which is why it is a list.
 */
export const ATTACHMENT_KINDS = ["receipt", "invoice", "quote", "warranty", "photo", "other"];

export async function getMaintenanceAttachments(id) {
  const res = await get(`/fleet/maintenance/${id}/attachments`);
  return res?.data || [];
}

export function uploadMaintenanceAttachment(id, file, { kind = "receipt", note = "" } = {}) {
  const form = new FormData();
  form.append("file", file, file.name || "receipt");
  form.append("kind", kind);
  if (note) form.append("note", note);
  return postForm(`/fleet/maintenance/${id}/attachments`, form);
}

/* Behind an authenticated route — a receipt is a financial record — so it is
 * fetched as data rather than pointed at with a src. */
export const maintenanceAttachmentDataUrl = (attachmentId) =>
  getDataUrl(`/fleet/maintenance/attachments/${attachmentId}`);

export const deleteMaintenanceAttachment = (attachmentId) =>
  del(`/fleet/maintenance/attachments/${attachmentId}`);

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
    parts: Array.isArray(m.parts) ? m.parts.map((p) => ({ itemId: p.itemId, name: p.name, unit: p.unit, quantity: p.quantity, consumed: p.consumed })) : undefined,
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
    parts: Array.isArray(f.parts)
      ? f.parts.filter((p) => p.itemId && p.quantity > 0).map((p) => ({ itemId: p.itemId, quantity: Number(p.quantity) }))
      : undefined,
  };
}

export async function getMaintenanceById(id) {
  const res = await get(`/fleet/maintenance/${id}`);
  return mapRecord(res.data);
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
