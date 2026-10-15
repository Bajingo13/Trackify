import { get, patch, del, postForm, getDataUrl } from "../apiClient";
import { licenceExpiry } from "./licenceExpiry";

/**
 * A photograph of the driver's licence.
 *
 * Only an authorized office user uploads or replaces this. The Driver App has
 * a separate view-only endpoint. It is an identity document behind an authenticated route,
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

/**
 * Read a photographed licence and say what is on it. Stores nothing — it works
 * in the Add Driver form, before the driver exists — so the caller keeps the
 * file and uploads it with uploadDriverLicensePhoto once the driver is saved.
 * `driverId` (when editing) stops the driver's own number being reported as a
 * duplicate.
 *
 * Resolves to { status: "read" | "not_a_licence" | "unsupported" | "unavailable",
 * message?, fields: { licenseNo, firstName, lastName, licenseType, licenseExpiry },
 * confidence, expired, daysLeft, duplicateOf? }.
 */
export function scanDriverLicense(file, driverId) {
  const form = new FormData();
  form.append("photo", file, file.name || "licence.jpg");
  const query = driverId ? `?driverId=${encodeURIComponent(driverId)}` : "";
  return postForm(`/fleet/drivers/license-scan${query}`, form).then((r) => r.data);
}

/**
 * The driver's own picture, set from the Driver app.
 *
 * Behind an authenticated route, so it is fetched as data rather than pointed
 * at with a src. `version` is the photo's updated-at stamp: it is not read by
 * the server, it only makes a replacement a different URL, so a new photo is
 * never shown as the old one from the browser's cache. A driver with no picture
 * answers 404 — an ordinary answer, shown as initials.
 */
export const getDriverPhoto = (driverId, version = "") =>
  getDataUrl(`/fleet/drivers/${driverId}/photo?v=${encodeURIComponent(version || "")}`);

export const DRIVER_STATUSES = ["Available", "On Trip", "Licence Expired", "No Licence Expiry", "Inactive"];
export const LICENSE_TYPES = ["Non-Professional", "Professional", "Student", "Conductor"];
/** What a driver's licence is taken to be until it says otherwise — the office's usual case. */
export const DEFAULT_LICENSE_TYPE = "Professional";
export const CERT_STATUSES = ["Valid", "Expiring Soon", "Expired"];

// "Available" only when dispatch would accept the driver: the server reports a
// free driver whose licence has lapsed, or has no expiry on record, separately.
const OP_LABEL = {
  available: "Available", on_trip: "On Trip", inactive: "Inactive",
  licence_expired: "Licence Expired", no_licence_expiry: "No Licence Expiry",
};

function mapDriver(d) {
  return {
    id: d.driver_id,
    employeeNo: d.employee_no || "",
    firstName: d.first_name,
    lastName: d.last_name,
    contactNo: d.phone || "",
    phone: d.phone || "",
    licenseNo: d.license_no,
    licenseType: d.license_type || DEFAULT_LICENSE_TYPE,
    licenseExpiry: d.license_expiry || null,
    licenseState: d.license_state || null,
    licenseDaysLeft: d.license_days_left == null ? null : Number(d.license_days_left),
    licenseExpiryText: d.license_expiry_text || null,
    hasLicensePhoto: !!d.has_license_photo,
    homeBranch: d.home_branch || "",
    homeBranchId: d.home_branch_id || null,
    status: OP_LABEL[d.operational_status] || OP_LABEL[d.status] || "Available",
    rawStatus: d.status,
    appEnabled: !!d.app_enabled,
    hasPin: !!d.has_pin,
    hasPhoto: !!d.has_photo,
    photoUpdatedAt: d.photo_updated_at || null,
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
    // no employeeNo: it is assigned by the system on registration and never changes
    firstName: d.firstName, lastName: d.lastName,
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
    rows = rows.filter((r) => getLicenseExpiryStatus(r) === filters.licenseStatus);
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

/**
 * Register credentials, the reviewed profile and the readable licence photo in
 * one multipart request. The server saves them atomically.
 */
/**
 * Register a driver. Resolves to { success, data: { driverId, employeeNo } } —
 * employeeNo is assigned by the server, and is what the driver signs in with.
 */
export async function createDriver(data, licenseFile) {
  const form = new FormData();
  for (const [key, value] of Object.entries(toPayload(data))) {
    if (value !== undefined && value !== null && value !== "") form.append(key, String(value));
  }
  form.append("pin", String(data.pin || ""));
  form.append("licenseReviewed", String(Boolean(data.licenseReviewed)));
  if (licenseFile) form.append("photo", licenseFile, licenseFile.name || "licence.jpg");
  return postForm("/fleet/drivers", form);
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

/** Bring a deactivated driver back: dispatchable again, and able to sign in to the Driver App. */
export async function reactivateDriver(id) {
  try {
    await patch(`/fleet/drivers/${id}`, { status: "active" });
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
    // free, but not dispatchable until the licence is sorted out
    licenceBlocked: s.licenceBlocked || 0,
    // licences the office has to act on, counted by the server with the shared rule
    licence: {
      expired: s.licence?.expired || 0,
      expiring: s.licence?.expiring || 0,
    },
  };
}

/** "Valid" | "Expiring Soon" | "Expired". No expiry on file counts as valid, as Reports does: a data gap, not a lapse. */
export function getLicenseExpiryStatus(driverOrExpiry) {
  if (driverOrExpiry && typeof driverOrExpiry === "object") {
    const state = driverOrExpiry.licenseState;
    if (state === "expired") return "Expired";
    if (state === "expiring") return "Expiring Soon";
    if (state === "valid" || state === "none") return "Valid";
    return licenceExpiry(driverOrExpiry.licenseExpiry).label;
  }
  return licenceExpiry(driverOrExpiry).label;
}

export function isDriverAssignable(driver) {
  return driver && driver.status === "Available";
}

/* certifications are managed via Fleet → Compliance in this phase */
export async function addCertification() { return { success: false, message: "Manage certifications under Fleet → Compliance." }; }
export async function updateCertification() { return { success: false, message: "Manage certifications under Fleet → Compliance." }; }
export async function removeCertification() { return { success: false, message: "Manage certifications under Fleet → Compliance." }; }
