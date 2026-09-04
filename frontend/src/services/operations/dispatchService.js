import { get, post } from "../apiClient";

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

export function fmtDate(v) {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : "—";
}
export function fmtDateTime(v) {
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return "Not scheduled";
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/* ---- snake_case → camelCase adapters (backend returns raw rows) ---- */
function mapTrip(t = {}) {
  return {
    id: t.trip_ticket_id ?? t.id,
    trip_ticket_id: t.trip_ticket_id ?? t.id,
    ticketNo: t.ticket_no ?? t.ticketNo ?? "—",
    customer: t.customer_name ?? t.customer ?? "—",
    origin: t.origin ?? "—",
    destination: t.destination ?? "—",
    scheduledDeparture: t.scheduled_departure ?? t.scheduledDeparture ?? null,
    priority: t.priority ?? "normal",
    cargoDescription: t.cargo_description ?? t.cargoDescription ?? "",
    cargoWeight: num(t.cargo_weight ?? t.cargoWeight),
    // the board endpoint only ever returns approved trips
    status: t.status ?? "approved",
  };
}

function mapDriver(d = {}) {
  return {
    id: d.driver_id ?? d.id,
    driver_id: d.driver_id ?? d.id,
    name: d.driver_name ?? d.name ?? `Driver #${d.driver_id ?? d.id ?? "?"}`,
    employeeNo: d.employee_no ?? d.employeeNo ?? "",
    licenseNo: d.license_no ?? d.licenseNo ?? "—",
    licenseType: d.license_type ?? d.licenseType ?? "",
    licenseExpiry: d.license_expiry ?? d.licenseExpiry ?? null,
    phone: d.phone ?? d.phone_no ?? "",
    // the board only returns active drivers whose licence is still valid
    status: d.status ?? "active",
  };
}

function mapVehicle(v = {}) {
  return {
    id: v.vehicle_id ?? v.id,
    vehicle_id: v.vehicle_id ?? v.id,
    plateNo: v.plate_no ?? v.plateNo ?? "—",
    type: v.vehicle_type ?? v.type ?? "—",
    capacity: num(v.capacity) ?? 0,
    odometer: num(v.odometer),
    registrationExpiry: v.registration_expiry ?? v.registrationExpiry ?? null,
    // the board only returns active vehicles with valid registration
    status: v.status ?? "active",
  };
}

export async function getDispatchBoard() {
  const res = await get("/operations/dispatch/board");
  const d = res?.data || res || {};
  return {
    unassignedTrips: (d.unassignedTrips || []).map(mapTrip),
    availableDrivers: (d.availableDrivers || []).map(mapDriver),
    availableVehicles: (d.availableVehicles || []).map(mapVehicle),
  };
}

/**
 * Client-side pre-flight for an assignment. States: pass | warn | fail | pending.
 * Nothing is "failed" just because you haven't picked yet — those show as pending.
 * The API re-checks everything on submit; this is only to guide the dispatcher.
 */
export function validateAssignment(trip, driver, vehicle) {
  const now = Date.now();
  const soon = now + 30 * 864e5;
  const checks = [];

  if (!driver) {
    checks.push({ label: "Driver", state: "pending", message: "Select a driver" });
  } else {
    checks.push({ label: "Driver available", state: "pass", message: "Available now" });
    const exp = driver.licenseExpiry ? new Date(driver.licenseExpiry).getTime() : NaN;
    if (Number.isNaN(exp)) {
      checks.push({ label: "Licence", state: "warn", message: "No expiry on file" });
    } else if (exp <= now) {
      checks.push({ label: "Licence valid", state: "fail", message: `Expired ${fmtDate(driver.licenseExpiry)}` });
    } else {
      checks.push({
        label: "Licence valid",
        state: exp <= soon ? "warn" : "pass",
        message: `${exp <= soon ? "Expiring " : "Valid to "}${fmtDate(driver.licenseExpiry)}`,
      });
    }
  }

  if (!vehicle) {
    checks.push({ label: "Vehicle", state: "pending", message: "Select a vehicle" });
  } else {
    checks.push({ label: "Vehicle available", state: "pass", message: "Available now" });
    const rexp = vehicle.registrationExpiry ? new Date(vehicle.registrationExpiry).getTime() : NaN;
    if (Number.isNaN(rexp)) {
      checks.push({ label: "Registration", state: "warn", message: "No expiry on file" });
    } else if (rexp <= now) {
      checks.push({ label: "Registration valid", state: "fail", message: `Expired ${fmtDate(vehicle.registrationExpiry)}` });
    } else {
      checks.push({ label: "Registration valid", state: "pass", message: `Valid to ${fmtDate(vehicle.registrationExpiry)}` });
    }
  }

  if (driver && vehicle && trip?.cargoWeight != null && vehicle.capacity) {
    const ok = trip.cargoWeight <= vehicle.capacity;
    checks.push({
      label: "Capacity",
      state: ok ? "pass" : "fail",
      message: ok
        ? `${trip.cargoWeight.toLocaleString()} / ${vehicle.capacity.toLocaleString()} kg`
        : `Cargo exceeds ${vehicle.capacity.toLocaleString()} kg`,
    });
  }

  checks.push({
    label: "Trip approved",
    state: trip?.status === "approved" ? "pass" : "fail",
    message: trip ? `Status: ${(trip.status || "unknown").replace(/_/g, " ")}` : "No trip",
  });

  const hasBlocker = checks.some((c) => c.state === "fail");
  const ready = !!driver && !!vehicle && !hasBlocker;
  return { checks, ready, allPassed: ready };
}

export async function assignTrip(tripId, driverId, vehicleId, opts = {}) {
  const body = { driverId, vehicleId };
  if (opts.allowCrossBranch) body.allowCrossBranch = true;
  const res = await post(`/operations/dispatch/trips/${tripId}/assign`, body);
  return res;
}
