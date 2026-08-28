import { logAudit } from "../auditService";

const MAINTENANCE_TYPES = ["Oil Change", "Brake Inspection", "Tire Replacement", "Engine Service", "Battery Check", "General Inspection", "Preventive Maintenance", "Corrective Maintenance", "Other"];
const MAINTENANCE_STATUSES = ["Scheduled", "Due", "Overdue", "In Progress", "Completed", "Cancelled"];

let nextId = 100;

const maintenanceRecords = [
  { id: 1, vehicleId: 1, vehiclePlate: "ABC 1234", type: "Oil Change", serviceDate: "2025-12-01", odometerAtService: 42000, technician: "Mike's Auto Shop", cost: 3500, partsUsed: "Engine Oil 5W-40, Oil Filter", findings: "Normal wear, oil level good", status: "Completed", nextServiceDate: "2026-03-01", nextServiceOdometer: 47000, notes: "", createdAt: "2025-12-01" },
  { id: 2, vehicleId: 1, vehiclePlate: "ABC 1234", type: "Preventive Maintenance", serviceDate: "2026-03-01", odometerAtService: 47000, technician: "TBD", cost: null, partsUsed: "", findings: "", status: "Scheduled", nextServiceDate: "2026-06-01", nextServiceOdometer: 52000, notes: "Regular PM schedule", createdAt: "2025-12-01" },
  { id: 3, vehicleId: 2, vehiclePlate: "XYZ 5678", type: "Brake Inspection", serviceDate: "2025-11-20", odometerAtService: 30000, technician: " dealer Service Center", cost: 2800, partsUsed: "Brake Pads Front", findings: "Front brake pads at 40%, rear at 60%", status: "Completed", nextServiceDate: "2026-05-20", nextServiceOdometer: 36000, notes: "", createdAt: "2025-11-20" },
  { id: 4, vehicleId: 4, vehiclePlate: "GHI 3456", type: "Engine Service", serviceDate: "2026-01-20", odometerAtService: 28700, technician: "Ford Service Center", cost: 15000, partsUsed: "Timing Belt, Spark Plugs", findings: "Timing belt shows wear, replaced", status: "In Progress", nextServiceDate: null, nextServiceOdometer: null, notes: "Major service ongoing", createdAt: "2026-01-20" },
  { id: 5, vehicleId: 5, vehiclePlate: "JKL 7890", type: "Oil Change", serviceDate: "2025-10-15", odometerAtService: 65000, technician: "Mike's Auto Shop", cost: 3800, partsUsed: "Engine Oil 15W-40, Oil Filter", findings: "Engine running well", status: "Completed", nextServiceDate: "2026-01-15", nextServiceOdometer: 70000, notes: "", createdAt: "2025-10-15" },
  { id: 6, vehicleId: 5, vehiclePlate: "JKL 7890", type: "Oil Change", serviceDate: "2026-01-15", odometerAtService: 70000, technician: "TBD", cost: null, partsUsed: "", findings: "", status: "Overdue", nextServiceDate: "2026-01-15", nextServiceOdometer: 70000, notes: "Overdue - schedule immediately", createdAt: "2025-10-15" },
  { id: 7, vehicleId: 7, vehiclePlate: "PQR 6789", type: "Tire Replacement", serviceDate: "2026-01-20", odometerAtService: 90000, technician: "Tire King Shop", cost: 24000, partsUsed: "4x Continental HT6, Alignment", findings: "All 4 tires replaced, alignment done", status: "Scheduled", nextServiceDate: "2026-01-20", nextServiceOdometer: 90000, notes: "", createdAt: "2025-12-20" },
  { id: 8, vehicleId: 12, vehiclePlate: "EFG 6789", type: "Battery Check", serviceDate: "2026-01-18", odometerAtService: 51000, technician: "Electro Parts Inc", cost: 5500, partsUsed: "NS40Z Battery", findings: "Old battery replaced, charging system OK", status: "In Progress", nextServiceDate: null, nextServiceOdometer: null, notes: "", createdAt: "2026-01-18" },
];

export function getAllMaintenance(filters = {}) {
  let result = [...maintenanceRecords];
  if (filters.status) result = result.filter((m) => m.status === filters.status);
  if (filters.type) result = result.filter((m) => m.type === filters.type);
  if (filters.vehicleId) result = result.filter((m) => m.vehicleId === filters.vehicleId);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (m) =>
        m.vehiclePlate.toLowerCase().includes(q) ||
        m.type.toLowerCase().includes(q) ||
        m.technician.toLowerCase().includes(q) ||
        (m.findings && m.findings.toLowerCase().includes(q))
    );
  }
  if (filters.sort) {
    const [key, dir] = filters.sort.split(":");
    result.sort((a, b) => {
      const va = a[key] ?? "";
      const vb = b[key] ?? "";
      const cmp = typeof va === "string" ? va.localeCompare(vb) : (va || 0) - (vb || 0);
      return dir === "desc" ? -cmp : cmp;
    });
  }
  const page = filters.page || 1;
  const limit = filters.limit || 10;
  const total = result.length;
  const paginated = result.slice((page - 1) * limit, page * limit);
  return { data: paginated, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export function getMaintenanceById(id) {
  return maintenanceRecords.find((m) => m.id === id) || null;
}

export function getMaintenanceByVehicleId(vehicleId) {
  return maintenanceRecords.filter((m) => m.vehicleId === vehicleId);
}

export function createMaintenance(data) {
  const record = {
    id: nextId++,
    ...data,
    createdAt: new Date().toISOString().split("T")[0],
  };
  maintenanceRecords.push(record);
  logAudit({ module: "Maintenance", action: "Maintenance Scheduled", referenceId: record.id, newValue: record });
  return record;
}

export function updateMaintenance(id, data, reason = "") {
  const idx = maintenanceRecords.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  const prev = { ...maintenanceRecords[idx] };
  maintenanceRecords[idx] = { ...maintenanceRecords[idx], ...data };
  logAudit({ module: "Maintenance", action: "Maintenance Updated", referenceId: id, previousValue: prev, newValue: maintenanceRecords[idx], reason });
  return maintenanceRecords[idx];
}

export function completeMaintenance(id, { cost, partsUsed, findings }) {
  const record = maintenanceRecords.find((m) => m.id === id);
  if (!record) return { success: false, message: "Maintenance record not found." };
  const prev = { status: record.status };
  record.status = "Completed";
  record.cost = cost || record.cost;
  record.partsUsed = partsUsed || record.partsUsed;
  record.findings = findings || record.findings;
  logAudit({ module: "Maintenance", action: "Maintenance Completed", referenceId: id, previousValue: prev, newValue: { status: "Completed" } });
  return { success: true, record };
}

export function getMaintenanceStats() {
  const total = maintenanceRecords.length;
  const scheduled = maintenanceRecords.filter((m) => m.status === "Scheduled").length;
  const due = maintenanceRecords.filter((m) => m.status === "Due").length;
  const overdue = maintenanceRecords.filter((m) => m.status === "Overdue").length;
  const inProgress = maintenanceRecords.filter((m) => m.status === "In Progress").length;
  const completed = maintenanceRecords.filter((m) => m.status === "Completed").length;
  const cancelled = maintenanceRecords.filter((m) => m.status === "Cancelled").length;
  return { total, scheduled, due, overdue, inProgress, completed, cancelled };
}

export function deleteMaintenance(id) {
  const idx = maintenanceRecords.findIndex((m) => m.id === id);
  if (idx === -1) return { success: false, message: "Maintenance record not found." };
  const removed = maintenanceRecords.splice(idx, 1)[0];
  logAudit({ module: "Maintenance", action: "Maintenance Deleted", referenceId: id, previousValue: removed });
  return { success: true };
}

export { MAINTENANCE_TYPES, MAINTENANCE_STATUSES };
