const exceptions = [
  {
    id: 1,
    tripTicket: "DVO-2026-0017",
    type: "trip_delay",
    severity: "warning",
    title: "Trip Delayed - Traffic Congestion",
    description: "Heavy traffic encountered at Bukidnon highway section. Estimated 30-minute delay to destination.",
    location: "Bukidnon Highway",
    driver: "Ricardo Villanueva",
    vehicle: "ABC 1236",
    status: "open",
    detectedAt: "2026-08-28T05:30:00",
    acknowledgedAt: null,
    resolvedAt: null,
    resolutionNotes: null,
  },
  {
    id: 2,
    tripTicket: "DVO-2026-0018",
    type: "route_deviation",
    severity: "critical",
    title: "Route Deviation Detected",
    description: "Vehicle deviated from planned route by 2.5km. Driver reports road closure due to construction.",
    location: "Digos City",
    driver: "Eduardo Cruz",
    vehicle: "GEN 3001",
    status: "open",
    detectedAt: "2026-08-28T06:45:00",
    acknowledgedAt: null,
    resolvedAt: null,
    resolutionNotes: null,
  },
  {
    id: 3,
    tripTicket: null,
    type: "vehicle_maintenance_block",
    severity: "warning",
    title: "Vehicle ABC 1236 Maintenance Due",
    description: "Vehicle ABC 1236 (Refrigerated Van) is due for preventive maintenance in 3 days. Schedule maintenance to avoid trip disruptions.",
    location: "Davao Branch",
    driver: null,
    vehicle: "ABC 1236",
    status: "open",
    detectedAt: "2026-08-28T08:00:00",
    acknowledgedAt: null,
    resolvedAt: null,
    resolutionNotes: null,
  },
  {
    id: 4,
    tripTicket: "DVO-2026-0019",
    type: "gps_offline",
    severity: "warning",
    title: "GPS Signal Intermittent",
    description: "GPS signal lost for 15 minutes near Pagadian area. Driver reports entering tunnel zone.",
    location: "Pagadian City",
    driver: "Fernando Gonzales",
    vehicle: "ABC 1235",
    status: "acknowledged",
    detectedAt: "2026-08-28T01:15:00",
    acknowledgedAt: "2026-08-28T01:30:00",
    resolvedAt: null,
    resolutionNotes: null,
  },
  {
    id: 5,
    tripTicket: null,
    type: "driver_license_issue",
    severity: "info",
    title: "Driver License Expiring Soon",
    description: "Driver Roberto Fernandez (DRV-009) license expires on October 28, 2026. Schedule renewal before expiry.",
    location: "Davao Branch",
    driver: "Roberto Fernandez",
    vehicle: null,
    status: "acknowledged",
    detectedAt: "2026-08-26T14:00:00",
    acknowledgedAt: "2026-08-27T09:00:00",
    resolvedAt: null,
    resolutionNotes: null,
  },
  {
    id: 6,
    tripTicket: "DVO-2026-0015",
    type: "cargo_damage",
    severity: "critical",
    title: "Minor Cargo Damage Reported",
    description: "2 boxes of marketing materials damaged during unloading. Client notified and replacement arranged.",
    location: "Valencia City",
    driver: "Jose Garcia",
    vehicle: "CEB 2001",
    status: "resolved",
    detectedAt: "2026-08-28T05:45:00",
    acknowledgedAt: "2026-08-28T06:00:00",
    resolvedAt: "2026-08-28T08:00:00",
    resolutionNotes: "Replacement shipped via next available trip. Client compensated with 10% discount on next order.",
  },
  {
    id: 7,
    tripTicket: "DVO-2026-0016",
    type: "failed_delivery",
    severity: "warning",
    title: "Delivery Attempt Failed",
    description: "Recipient not available at delivery address. Package returned to driver for re-delivery.",
    location: "Malaybalay, Bukidnon",
    driver: "Antonio Lopez",
    vehicle: "CEB 2002",
    status: "resolved",
    detectedAt: "2026-08-28T04:15:00",
    acknowledgedAt: "2026-08-28T04:30:00",
    resolvedAt: "2026-08-28T05:00:00",
    resolutionNotes: "Re-delivery scheduled for tomorrow 8AM. Contact recipient to confirm availability.",
  },
  {
    id: 8,
    tripTicket: null,
    type: "schedule_conflict",
    severity: "info",
    title: "Schedule Overlap Detected",
    description: "Driver Juan Dela Cruz has overlapping trip assignments on Aug 30. Review and resolve conflict.",
    location: "Davao Branch",
    driver: "Juan Dela Cruz",
    vehicle: null,
    status: "resolved",
    detectedAt: "2026-08-27T09:00:00",
    acknowledgedAt: "2026-08-27T10:00:00",
    resolvedAt: "2026-08-27T14:00:00",
    resolutionNotes: "Reassigned Trip 10 to Driver Pedro Santos. Updated dispatch records.",
  },
];

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
