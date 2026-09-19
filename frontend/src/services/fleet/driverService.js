import { get, post, patch, del, postForm, getDataUrl } from "../apiClient";

/**
 * A photograph of the driver's licence.
 *
 * The driver can take this themselves from the app; the office uploads or
 * replaces it here. It is an identity document behind an authenticated route,
 * so it is fetched as data rather than pointed at with a src.
 *
 * A driver with no photo on file answers 404, which is an ordinary answer
 * rather than an error — the caller shows the empty state.
 */
export const getDriverLicensePhoto = (driverId) =>
  getDataUrl(`/fleet/drivers/${driverId}/license-photo`);

export function uploadDriverLicensePhoto(driverId, file) {
  const form = new FormData();
  form.append("photo", file, file.name || "licence.jpg");
  return postForm(`/fleet/drivers/${driverId}/license-photo`, form);
}

export const deleteDriverLicensePhoto = (driverId) =>
  del(`/fleet/drivers/${driverId}/license-photo`);

export const DRIVER_STATUSES = ["Available", "On Trip", "Inactive"];
export const LICENSE_TYPES = ["Non-Professional", "Professional", "Student", "Conductor"];
export const CERT_STATUSES = ["Valid", "Expiring Soon", "Expired"];

const OP_LABEL = { available: "Available", on_trip: "On Trip", inactive: "Inactive" };

function mapDriver(d) {
  return {
    id: d.driver_id,
    employeeNo: d.employee_no || "",
    firstName: d.first_name,
    lastName: d.last_name,
    contactNo: d.phone || "",
    phone: d.phone || "",
    licenseNo: d.license_no,
    licenseType: d.license_type || "",
    licenseExpiry: d.license_expiry || null,
    homeBranch: d.home_branch || "",
    homeBranchId: d.home_branch_id || null,
    status: OP_LABEL[d.operational_status] || OP_LABEL[d.status] || "Available",
    rawStatus: d.status,
    appEnabled: !!d.app_enabled,
    hasPin: !!d.has_pin,
    currentTrip: d.current_trip_no || null,
    assignedVehicleId: null,
    certifications: [],
    emergencyContact: {
      name: d.emergency_contact_name || "",
      phone: d.emergency_contact_phone || "",
      relationship: d.emergency_contact_relation || "",
    },
    createdAt: d.created_at,
  };
}

function toPayload(d) {
  const ec = d.emergencyContact || {};
  return {
    employeeNo: d.employeeNo, firstName: d.firstName, lastName: d.lastName,
    phone: d.contactNo ?? d.phone, licenseNo: d.licenseNo, licenseType: d.licenseType,
    licenseExpiry: d.licenseExpiry, homeBranchId: d.homeBranchId,
    emergencyContactName: ec.name, emergencyContactPhone: ec.phone, emergencyContactRelation: ec.relationship,
  };
}

export async function getAllDrivers(filters = {}) {
  const q = new URLSearchParams();
  if (filters.search) q.set("search", filters.search);
  if (filters.licenseType) q.set("licenseType", filters.licenseType);
  const res = await get(`/fleet/drivers${q.toString() ? `?${q}` : ""}`);
  let rows = (res.data || []).map(mapDriver);

  // "On Trip" is derived from active assignments — filter client-side
  if (filters.status) rows = rows.filter((r) => r.status === filters.status);
  if (filters.licenseStatus) {
    rows = rows.filter((r) => getLicenseExpiryStatus(r.licenseExpiry) === filters.licenseStatus);
  }

  const page = filters.page || 1;
  const limit = filters.limit || 10;
  const total = rows.length;
  return { data: rows.slice((page - 1) * limit, page * limit), total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export async function getDriverById(id) {
  const res = await get(`/fleet/drivers/${id}`);
  return mapDriver(res.data);
}

export async function createDriver(data) {
  return post("/fleet/drivers", toPayload(data));
}

export async function updateDriver(id, data) {
  return patch(`/fleet/drivers/${id}`, toPayload(data));
}

/** Set/reset the Driver App PIN, or toggle app access. */
export async function setDriverAppAccess(id, body) {
  return patch(`/fleet/drivers/${id}/app-access`, body);
}

export async function deleteDriver(id) {
  try {
    await patch(`/fleet/drivers/${id}`, { status: "inactive" });
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

export async function getDriverStats() {
  const res = await get("/fleet/drivers/stats");
  const s = res.data || {};
  return {
    total: s.total || 0,
    available: s.available || 0,
    assigned: 0,
    onTrip: s.onTrip || 0,
    onLeave: 0,
    inactive: s.inactive || 0,
  };
}

export function getLicenseExpiryStatus(expiryDate) {
  if (!expiryDate) return "Valid";
  const days = Math.round((new Date(expiryDate) - Date.now()) / 86400000);
  if (days < 0) return "Expired";
  if (days <= 30) return "Expiring Soon";
  return "Valid";
}

export function isDriverAssignable(driver) {
  return driver && driver.status === "Available";
}

/* certifications are managed via Fleet → Compliance in this phase */
export async function addCertification() { return { success: false, message: "Manage certifications under Fleet → Compliance." }; }
export async function updateCertification() { return { success: false, message: "Manage certifications under Fleet → Compliance." }; }
export async function removeCertification() { return { success: false, message: "Manage certifications under Fleet → Compliance." }; }
