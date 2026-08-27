const exceptions = [];

const exceptionTypes = {
  trip_delay: "Trip Delay",
  route_deviation: "Route Deviation",
  gps_offline: "GPS Offline",
  vehicle_breakdown: "Vehicle Breakdown",
  driver_declined: "Driver Declined",
  failed_delivery: "Failed Delivery",
  cargo_shortage: "Cargo Shortage",
  cargo_damage: "Cargo Damage",
  missing_pod: "Missing POD",
  schedule_conflict: "Schedule Conflict",
  vehicle_maintenance_block: "Vehicle Maintenance Block",
  driver_license_issue: "Driver License Issue",
};

function getAllExceptions() {
  return [...exceptions];
}

function getExceptionById(id) {
  return exceptions.find((e) => e.id === id) || null;
}

function getExceptionsByStatus(status) {
  if (status === "all") return getAllExceptions();
  return exceptions.filter((e) => e.status === status);
}

function getExceptionsBySeverity(severity) {
  if (severity === "all") return getAllExceptions();
  return exceptions.filter((e) => e.severity === severity);
}

function getExceptionStats() {
  const total = exceptions.length;
  const open = exceptions.filter((e) => e.status === "open").length;
  const acknowledged = exceptions.filter((e) => e.status === "acknowledged").length;
  const resolved = exceptions.filter((e) => e.status === "resolved").length;
  const critical = exceptions.filter((e) => e.severity === "critical").length;
  const warning = exceptions.filter((e) => e.severity === "warning").length;
  const info = exceptions.filter((e) => e.severity === "info").length;
  return { total, open, acknowledged, resolved, critical, warning, info };
}

export {
  getAllExceptions,
  getExceptionById,
  getExceptionsByStatus,
  getExceptionsBySeverity,
  getExceptionStats,
  exceptionTypes,
  exceptions,
};
