import { logAudit } from "../auditService";

const DRIVER_STATUSES = ["Available", "Assigned", "On Trip", "On Leave", "Inactive"];
const LICENSE_TYPES = ["Non-Professional", "Professional", "Student", "Conductor"];
const CERT_STATUSES = ["Valid", "Expiring Soon", "Expired"];

let nextId = 100;

const drivers = [
  { id: 1, firstName: "Juan", lastName: "Dela Cruz", contactNo: "+63 917 123 4567", licenseNo: "N01-12-345678", licenseType: "Professional", licenseExpiry: "2027-08-15", certifications: [{ name: "Defensive Driving", certNo: "DD-2025-001", issueDate: "2025-01-15", expiryDate: "2027-01-15", issuingAuthority: "LTO", status: "Valid", document: null }], assignedVehicleId: 2, status: "On Trip", emergencyContact: { name: "Maria Dela Cruz", phone: "+63 917 987 6543", relationship: "Spouse" }, createdAt: "2024-01-15" },
  { id: 2, firstName: "Pedro", lastName: "Santos", contactNo: "+63 918 234 5678", licenseNo: "N01-12-987654", licenseType: "Professional", licenseExpiry: "2026-11-30", certifications: [{ name: "Defensive Driving", certNo: "DD-2025-002", issueDate: "2025-02-20", expiryDate: "2027-02-20", issuingAuthority: "LTO", status: "Valid", document: null }], assignedVehicleId: 3, status: "Assigned", emergencyContact: { name: "Ana Santos", phone: "+63 918 876 5432", relationship: "Wife" }, createdAt: "2024-03-20" },
  { id: 3, firstName: "Jose", lastName: "Reyes", contactNo: "+63 919 345 6789", licenseNo: "N01-12-567890", licenseType: "Non-Professional", licenseExpiry: "2026-03-20", certifications: [{ name: "First Aid", certNo: "FA-2025-003", issueDate: "2024-06-10", expiryDate: "2026-06-10", issuingAuthority: "Red Cross", status: "Valid", document: null }], assignedVehicleId: 8, status: "Assigned", emergencyContact: { name: "Rosa Reyes", phone: "+63 919 654 3210", relationship: "Mother" }, createdAt: "2024-06-10" },
  { id: 4, firstName: "Miguel", lastName: "Garcia", contactNo: "+63 920 456 7890", licenseNo: "N01-12-112233", licenseType: "Professional", licenseExpiry: "2025-12-31", certifications: [{ name: "Hazardous Materials", certNo: "HM-2024-004", issueDate: "2024-01-01", expiryDate: "2026-01-01", issuingAuthority: "DOLE", status: "Expired", document: null }], assignedVehicleId: 11, status: "On Trip", emergencyContact: { name: "Carmen Garcia", phone: "+63 920 543 2109", relationship: "Sister" }, createdAt: "2024-05-12" },
  { id: 5, firstName: "Andres", lastName: "Bautista", contactNo: "+63 921 567 8901", licenseNo: "N01-12-445566", licenseType: "Professional", licenseExpiry: "2028-05-15", certifications: [{ name: "Defensive Driving", certNo: "DD-2025-005", issueDate: "2025-03-01", expiryDate: "2027-03-01", issuingAuthority: "LTO", status: "Valid", document: null }], assignedVehicleId: null, status: "Available", emergencyContact: { name: "Elena Bautista", phone: "+63 921 210 9876", relationship: "Wife" }, createdAt: "2024-08-20" },
  { id: 6, firstName: "Ricardo", lastName: "Lim", contactNo: "+63 922 678 9012", licenseNo: "N01-12-778899", licenseType: "Professional", licenseExpiry: "2027-02-28", certifications: [], assignedVehicleId: null, status: "Available", emergencyContact: { name: "Susan Lim", phone: "+63 922 321 0987", relationship: "Wife" }, createdAt: "2024-09-15" },
  { id: 7, firstName: "Fernando", lastName: "Cruz", contactNo: "+63 923 789 0123", licenseNo: "N01-12-112244", licenseType: "Non-Professional", licenseExpiry: "2026-07-20", certifications: [{ name: "First Aid", certNo: "FA-2025-007", issueDate: "2025-07-20", expiryDate: "2027-07-20", issuingAuthority: "Red Cross", status: "Valid", document: null }], assignedVehicleId: null, status: "On Leave", emergencyContact: { name: "Isabel Cruz", phone: "+63 923 432 1098", relationship: "Husband" }, createdAt: "2024-10-01" },
  { id: 8, firstName: "Carlo", lastName: "Mendoza", contactNo: "+63 924 890 1234", licenseNo: "N01-12-556677", licenseType: "Student", licenseExpiry: "2025-06-30", certifications: [], assignedVehicleId: null, status: "Inactive", emergencyContact: { name: "Teresa Mendoza", phone: "+63 924 543 2109", relationship: "Mother" }, createdAt: "2024-11-10" },
];

export function getAllDrivers(filters = {}) {
  let result = [...drivers];
  if (filters.status) result = result.filter((d) => d.status === filters.status);
  if (filters.licenseType) result = result.filter((d) => d.licenseType === filters.licenseType);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (d) =>
        `${d.firstName} ${d.lastName}`.toLowerCase().includes(q) ||
        d.licenseNo.toLowerCase().includes(q) ||
        d.contactNo.includes(q) ||
        d.status.toLowerCase().includes(q)
    );
  }
  if (filters.sort) {
    const [key, dir] = filters.sort.split(":");
    result.sort((a, b) => {
      const va = key === "fullName" ? `${a.firstName} ${a.lastName}` : (a[key] ?? "");
      const vb = key === "fullName" ? `${b.firstName} ${b.lastName}` : (b[key] ?? "");
      const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  const page = filters.page || 1;
  const limit = filters.limit || 10;
  const total = result.length;
  const paginated = result.slice((page - 1) * limit, page * limit);
  return { data: paginated, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export function getDriverById(id) {
  return drivers.find((d) => d.id === id) || null;
}

export function createDriver(data) {
  const driver = {
    id: nextId++,
    ...data,
    certifications: data.certifications || [],
    assignedVehicleId: null,
    status: data.status || "Available",
    emergencyContact: data.emergencyContact || null,
    createdAt: new Date().toISOString().split("T")[0],
  };
  drivers.push(driver);
  logAudit({ module: "Fleet", action: "Driver Created", referenceId: driver.id, newValue: driver });
  return driver;
}

export function updateDriver(id, data, reason = "") {
  const idx = drivers.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  const prev = { ...drivers[idx] };
  drivers[idx] = { ...drivers[idx], ...data };
  logAudit({ module: "Fleet", action: "Driver Updated", referenceId: id, previousValue: prev, newValue: drivers[idx], reason });
  return drivers[idx];
}

export function addCertification(driverId, cert) {
  const driver = drivers.find((d) => d.id === driverId);
  if (!driver) return null;
  const newCert = { ...cert, id: Date.now() };
  driver.certifications.push(newCert);
  logAudit({ module: "Fleet", action: "Certification Added", referenceId: driverId, newValue: newCert });
  return newCert;
}

export function updateCertification(driverId, certId, data) {
  const driver = drivers.find((d) => d.id === driverId);
  if (!driver) return null;
  const idx = driver.certifications.findIndex((c) => c.id === certId);
  if (idx === -1) return null;
  const prev = { ...driver.certifications[idx] };
  driver.certifications[idx] = { ...driver.certifications[idx], ...data };
  logAudit({ module: "Fleet", action: "Certification Updated", referenceId: driverId, previousValue: prev, newValue: driver.certifications[idx] });
  return driver.certifications[idx];
}

export function removeCertification(driverId, certId) {
  const driver = drivers.find((d) => d.id === driverId);
  if (!driver) return false;
  const idx = driver.certifications.findIndex((c) => c.id === certId);
  if (idx === -1) return false;
  const removed = driver.certifications.splice(idx, 1)[0];
  logAudit({ module: "Fleet", action: "Certification Removed", referenceId: driverId, previousValue: removed });
  return true;
}

export function getDriverStats() {
  const total = drivers.length;
  const available = drivers.filter((d) => d.status === "Available").length;
  const assigned = drivers.filter((d) => d.status === "Assigned").length;
  const onTrip = drivers.filter((d) => d.status === "On Trip").length;
  const onLeave = drivers.filter((d) => d.status === "On Leave").length;
  const inactive = drivers.filter((d) => d.status === "Inactive").length;
  return { total, available, assigned, onTrip, onLeave, inactive };
}

export function getLicenseExpiryStatus(expiryDate) {
  if (!expiryDate) return "Unknown";
  const now = new Date();
  const expiry = new Date(expiryDate);
  const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "Expired";
  if (diffDays <= 90) return "Expiring Soon";
  return "Valid";
}

export function isDriverAssignable(driver) {
  if (driver.status === "Inactive" || driver.status === "On Leave") return false;
  if (getLicenseExpiryStatus(driver.licenseExpiry) === "Expired") return false;
  return true;
}

export function deleteDriver(id) {
  const idx = drivers.findIndex((d) => d.id === id);
  if (idx === -1) return { success: false, message: "Driver not found." };
  const driver = drivers[idx];
  if (driver.status === "On Trip") return { success: false, message: "Cannot delete a driver that is currently on a trip." };
  const removed = drivers.splice(idx, 1)[0];
  logAudit({ module: "Fleet", action: "Driver Deleted", referenceId: id, previousValue: removed });
  return { success: true };
}

export { DRIVER_STATUSES, LICENSE_TYPES, CERT_STATUSES };
