import { get, post } from "../apiClient";

export async function getDispatchBoard() {
  const res = await get("/operations/dispatch/board");
  return res.data;
}

export function validateAssignment(trip, driver, vehicle) {
  const checks = [];

  checks.push({
    label: "Driver available",
    passed: driver && driver.status === "active",
    message: driver ? "Driver is available" : "No driver selected",
  });

  checks.push({
    label: "License valid",
    passed: driver && new Date(driver.license_expiry) > new Date(),
    message: driver ? `Expires ${new Date(driver.license_expiry).toLocaleDateString()}` : "No driver selected",
  });

  checks.push({
    label: "Vehicle available",
    passed: vehicle && vehicle.status === "active",
    message: vehicle ? "Vehicle is available" : "No vehicle selected",
  });

  checks.push({
    label: "Registration valid",
    passed: vehicle && (!vehicle.registration_expiry || new Date(vehicle.registration_expiry) > new Date()),
    message: vehicle ? `Expires ${vehicle.registration_expiry ? new Date(vehicle.registration_expiry).toLocaleDateString() : "N/A"}` : "No vehicle selected",
  });

  checks.push({
    label: "Trip approved",
    passed: trip && trip.status === "approved",
    message: trip ? `Status: ${(trip.status || "").replace(/_/g, " ")}` : "No trip selected",
  });

  const allPassed = checks.every((c) => c.passed);
  return { checks, allPassed };
}

export async function assignTrip(tripId, driverId, vehicleId) {
  const res = await post(`/operations/dispatch/trips/${tripId}/assign`, { driverId, vehicleId });
  return res;
}
