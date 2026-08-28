import { logAudit } from "../auditService";

const VEHICLE_STATUSES = ["Available", "Assigned", "On Trip", "Reserved", "Maintenance", "Unavailable", "Retired"];
const VEHICLE_TYPES = ["Truck", "Van", "SUV", "Sedan", "Motorcycle", "Forklift", "Bus"];

let nextId = 100;

const vehicles = [
  { id: 1, plateNo: "ABC 1234", type: "Truck", brand: "Isuzu", model: "NLR", year: 2022, color: "White", capacityKg: 4500, odometerReading: 45230, currentLocation: "Makati DC", status: "Available", assignedDriverId: null, currentAssignment: null, lastInspection: "2025-11-15", lastMaintenance: "2025-12-01", nextMaintenance: "2026-03-01", nextMaintenanceOdometer: 50000, registrationExpiry: "2027-06-30", insuranceExpiry: "2027-06-30", createdAt: "2024-01-15" },
  { id: 2, plateNo: "XYZ 5678", type: "Truck", brand: "Mitsubishi", model: "Canter", year: 2023, color: "Blue", capacityKg: 3500, odometerReading: 32100, currentLocation: "Makati DC", status: "On Trip", assignedDriverId: 1, currentAssignment: "TRK-2026-001", lastInspection: "2025-12-10", lastMaintenance: "2025-11-20", nextMaintenance: "2026-02-20", nextMaintenanceOdometer: 35000, registrationExpiry: "2027-12-31", insuranceExpiry: "2027-12-31", createdAt: "2024-03-20" },
  { id: 3, plateNo: "DEF 9012", type: "Van", brand: "Toyota", model: "HiAce", year: 2024, color: "Silver", capacityKg: 1200, odometerReading: 12500, currentLocation: "Cebu Branch", status: "Assigned", assignedDriverId: 2, currentAssignment: null, lastInspection: "2026-01-05", lastMaintenance: "2026-01-05", nextMaintenance: "2026-04-05", nextMaintenanceOdometer: 15000, registrationExpiry: "2028-01-31", insuranceExpiry: "2028-01-31", createdAt: "2024-06-10" },
  { id: 4, plateNo: "GHI 3456", type: "SUV", brand: "Ford", model: "Everest", year: 2023, color: "Black", capacityKg: 800, odometerReading: 28700, currentLocation: "Makati DC", status: "Maintenance", assignedDriverId: null, currentAssignment: null, lastInspection: "2026-01-20", lastMaintenance: "2026-01-20", nextMaintenance: "2026-07-20", nextMaintenanceOdometer: 35000, registrationExpiry: "2027-03-15", insuranceExpiry: "2027-03-15", createdAt: "2024-02-28" },
  { id: 5, plateNo: "JKL 7890", type: "Truck", brand: "Hino", model: "300 Series", year: 2021, color: "White", capacityKg: 5000, odometerReading: 67800, currentLocation: "Davao Branch", status: "Available", assignedDriverId: null, currentAssignment: null, lastInspection: "2025-10-01", lastMaintenance: "2025-10-15", nextMaintenance: "2026-01-15", nextMaintenanceOdometer: 70000, registrationExpiry: "2026-09-30", insuranceExpiry: "2026-09-30", createdAt: "2023-08-15" },
  { id: 6, plateNo: "MNO 2345", type: "Van", brand: "Nissan", model: "NV350", year: 2024, color: "White", capacityKg: 1000, odometerReading: 8200, currentLocation: "Makati DC", status: "Reserved", assignedDriverId: null, currentAssignment: "RES-2026-003", lastInspection: "2026-02-01", lastMaintenance: "2026-02-01", nextMaintenance: "2026-05-01", nextMaintenanceOdometer: 10000, registrationExpiry: "2028-02-28", insuranceExpiry: "2028-02-28", createdAt: "2024-09-05" },
  { id: 7, plateNo: "PQR 6789", type: "Truck", brand: "Isuzu", model: "FVR", year: 2020, color: "Red", capacityKg: 6000, odometerReading: 89200, currentLocation: "Clark Depot", status: "Available", assignedDriverId: null, currentAssignment: null, lastInspection: "2025-09-15", lastMaintenance: "2025-09-20", nextMaintenance: "2026-01-20", nextMaintenanceOdometer: 90000, registrationExpiry: "2026-08-31", insuranceExpiry: "2026-08-31", createdAt: "2023-05-10" },
  { id: 8, plateNo: "STU 0123", type: "Sedan", brand: "Toyota", model: "Vios", year: 2025, color: "Gray", capacityKg: 400, odometerReading: 3200, currentLocation: "Makati DC", status: "Assigned", assignedDriverId: 3, currentAssignment: null, lastInspection: "2026-02-10", lastMaintenance: "2026-02-10", nextMaintenance: "2026-05-10", nextMaintenanceOdometer: 5000, registrationExpiry: "2028-06-30", insuranceExpiry: "2028-06-30", createdAt: "2025-01-15" },
  { id: 9, plateNo: "VWX 4567", type: "Forklift", brand: "Toyota", model: "8FBE15", year: 2022, color: "Orange", capacityKg: 1500, odometerReading: 15600, currentLocation: "Makati DC", status: "Available", assignedDriverId: null, currentAssignment: null, lastInspection: "2025-12-20", lastMaintenance: "2025-12-22", nextMaintenance: "2026-03-22", nextMaintenanceOdometer: 18000, registrationExpiry: "2027-12-31", insuranceExpiry: "2027-12-31", createdAt: "2024-04-20" },
  { id: 10, plateNo: "YZA 8901", type: "Truck", brand: "Mitsubishi", model: "Fighter", year: 2019, color: "White", capacityKg: 7000, odometerReading: 112500, currentLocation: "Cebu Branch", status: "Unavailable", assignedDriverId: null, currentAssignment: null, lastInspection: "2025-08-01", lastMaintenance: "2025-08-10", nextMaintenance: "2025-12-10", nextMaintenanceOdometer: 115000, registrationExpiry: "2026-04-30", insuranceExpiry: "2026-04-30", createdAt: "2023-01-20" },
  { id: 11, plateNo: "BCD 2345", type: "Van", brand: "Hyundai", model: "Starex", year: 2023, color: "White", capacityKg: 900, odometerReading: 22100, currentLocation: "Davao Branch", status: "On Trip", assignedDriverId: 4, currentAssignment: "TRK-2026-002", lastInspection: "2025-11-25", lastMaintenance: "2025-11-28", nextMaintenance: "2026-02-28", nextMaintenanceOdometer: 25000, registrationExpiry: "2027-11-30", insuranceExpiry: "2027-11-30", createdAt: "2024-05-12" },
  { id: 12, plateNo: "EFG 6789", type: "Bus", brand: "Hyundai", model: "County", year: 2022, color: "White", capacityKg: 3000, odometerReading: 51000, currentLocation: "Clark Depot", status: "Maintenance", assignedDriverId: null, currentAssignment: null, lastInspection: "2026-01-15", lastMaintenance: "2026-01-18", nextMaintenance: "2026-04-18", nextMaintenanceOdometer: 55000, registrationExpiry: "2027-01-31", insuranceExpiry: "2027-01-31", createdAt: "2024-01-08" },
];

export function getAllVehicles(filters = {}) {
  let result = [...vehicles];
  if (filters.status) result = result.filter((v) => v.status === filters.status);
  if (filters.type) result = result.filter((v) => v.type === filters.type);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (v) =>
        v.plateNo.toLowerCase().includes(q) ||
        v.brand.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        v.type.toLowerCase().includes(q) ||
        v.currentLocation.toLowerCase().includes(q)
    );
  }
  if (filters.sort) {
    const [key, dir] = filters.sort.split(":");
    result.sort((a, b) => {
      const va = a[key] ?? "";
      const vb = b[key] ?? "";
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

export function getVehicleById(id) {
  return vehicles.find((v) => v.id === id) || null;
}

export function createVehicle(data) {
  const vehicle = {
    id: nextId++,
    ...data,
    odometerReading: data.odometerReading || 0,
    status: data.status || "Available",
    assignedDriverId: null,
    currentAssignment: null,
    lastInspection: null,
    lastMaintenance: null,
    nextMaintenance: null,
    nextMaintenanceOdometer: null,
    createdAt: new Date().toISOString().split("T")[0],
  };
  vehicles.push(vehicle);
  logAudit({ module: "Fleet", action: "Vehicle Created", referenceId: vehicle.id, newValue: vehicle });
  return vehicle;
}

export function updateVehicle(id, data, reason = "") {
  const idx = vehicles.findIndex((v) => v.id === id);
  if (idx === -1) return null;
  const prev = { ...vehicles[idx] };
  vehicles[idx] = { ...vehicles[idx], ...data };
  logAudit({ module: "Fleet", action: "Vehicle Updated", referenceId: id, previousValue: prev, newValue: vehicles[idx], reason });
  return vehicles[idx];
}

export function updateOdometer(id, newReading) {
  const vehicle = vehicles.find((v) => v.id === id);
  if (!vehicle) return { success: false, message: "Vehicle not found." };
  if (newReading < vehicle.odometerReading) {
    return { success: false, message: `New odometer reading (${newReading}) cannot be less than current reading (${vehicle.odometerReading}).` };
  }
  const prev = vehicle.odometerReading;
  vehicle.odometerReading = newReading;
  logAudit({ module: "Fleet", action: "Odometer Updated", referenceId: id, previousValue: { odometer: prev }, newValue: { odometer: newReading } });
  return { success: true, vehicle };
}

export function assignVehicleToDriver(vehicleId, driverId, assignmentRef = null) {
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return { success: false, message: "Vehicle not found." };
  if (vehicle.status === "Maintenance") return { success: false, message: "Cannot assign vehicle under maintenance." };
  if (vehicle.status === "Retired") return { success: false, message: "Cannot assign retired vehicle." };
  if (vehicle.status === "Unavailable") return { success: false, message: "Vehicle is currently unavailable." };
  const prev = { status: vehicle.status, assignedDriverId: vehicle.assignedDriverId, currentAssignment: vehicle.currentAssignment };
  vehicle.assignedDriverId = driverId;
  vehicle.currentAssignment = assignmentRef;
  vehicle.status = assignmentRef ? "On Trip" : "Assigned";
  logAudit({ module: "Fleet", action: "Vehicle Assigned", referenceId: vehicleId, previousValue: prev, newValue: { status: vehicle.status, assignedDriverId: driverId } });
  return { success: true, vehicle };
}

export function releaseVehicle(vehicleId) {
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return { success: false, message: "Vehicle not found." };
  const prev = { status: vehicle.status, assignedDriverId: vehicle.assignedDriverId, currentAssignment: vehicle.currentAssignment };
  vehicle.assignedDriverId = null;
  vehicle.currentAssignment = null;
  vehicle.status = "Available";
  logAudit({ module: "Fleet", action: "Vehicle Released", referenceId: vehicleId, previousValue: prev, newValue: { status: "Available" } });
  return { success: true, vehicle };
}

export function getVehicleStats() {
  const total = vehicles.length;
  const available = vehicles.filter((v) => v.status === "Available").length;
  const assigned = vehicles.filter((v) => v.status === "Assigned").length;
  const onTrip = vehicles.filter((v) => v.status === "On Trip").length;
  const reserved = vehicles.filter((v) => v.status === "Reserved").length;
  const maintenance = vehicles.filter((v) => v.status === "Maintenance").length;
  const unavailable = vehicles.filter((v) => v.status === "Unavailable").length;
  const retired = vehicles.filter((v) => v.status === "Retired").length;
  return { total, available, assigned, onTrip, reserved, maintenance, unavailable, retired };
}

export function getAvailabilityData() {
  return vehicles.map((v) => ({
    id: v.id,
    plateNo: v.plateNo,
    type: v.type,
    brand: v.brand,
    model: v.model,
    assignedDriverId: v.assignedDriverId,
    currentLocation: v.currentLocation,
    odometerReading: v.odometerReading,
    status: v.status,
    currentAssignment: v.currentAssignment,
    nextMaintenance: v.nextMaintenance,
    nextMaintenanceOdometer: v.nextMaintenanceOdometer,
  }));
}

export function deleteVehicle(id) {
  const idx = vehicles.findIndex((v) => v.id === id);
  if (idx === -1) return { success: false, message: "Vehicle not found." };
  const vehicle = vehicles[idx];
  if (vehicle.status === "On Trip") return { success: false, message: "Cannot delete a vehicle that is currently on a trip." };
  const removed = vehicles.splice(idx, 1)[0];
  logAudit({ module: "Fleet", action: "Vehicle Deleted", referenceId: id, previousValue: removed });
  return { success: true };
}

export { VEHICLE_STATUSES, VEHICLE_TYPES };
