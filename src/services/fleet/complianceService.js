import { getAllVehicles } from "./vehicleService";
import { getAllDrivers, getLicenseExpiryStatus } from "./driverService";
import { getAllMaintenance } from "./maintenanceService";

const PRIORITY_LEVELS = ["CRITICAL", "WARNING", "INFO"];

function getComplianceAlerts() {
  const alerts = [];
  let alertId = 1;
  const today = new Date();

  const drivers = getAllDrivers({ limit: 100 }).data;
  drivers.forEach((d) => {
    if (getLicenseExpiryStatus(d.licenseExpiry) === "Expired") {
      alerts.push({
        id: alertId++,
        type: "license_expired",
        priority: "CRITICAL",
        entity: "Driver",
        entityName: `${d.firstName} ${d.lastName}`,
        entityId: d.id,
        message: `Driver license expired on ${new Date(d.licenseExpiry).toLocaleDateString()}`,
        module: "Fleet",
      });
    } else if (getLicenseExpiryStatus(d.licenseExpiry) === "Expiring Soon") {
      alerts.push({
        id: alertId++,
        type: "license_expiring",
        priority: "WARNING",
        entity: "Driver",
        entityName: `${d.firstName} ${d.lastName}`,
        entityId: d.id,
        message: `Driver license expires on ${new Date(d.licenseExpiry).toLocaleDateString()}`,
        module: "Fleet",
      });
    }

    (d.certifications || []).forEach((c) => {
      if (c.status === "Expired") {
        alerts.push({
          id: alertId++,
          type: "cert_expired",
          priority: "CRITICAL",
          entity: "Certification",
          entityName: `${d.firstName} ${d.lastName} — ${c.name}`,
          entityId: d.id,
          message: `${c.name} certification expired on ${new Date(c.expiryDate).toLocaleDateString()}`,
          module: "Fleet",
        });
      } else if (c.status === "Expiring Soon") {
        alerts.push({
          id: alertId++,
          type: "cert_expiring",
          priority: "WARNING",
          entity: "Certification",
          entityName: `${d.firstName} ${d.lastName} — ${c.name}`,
          entityId: d.id,
          message: `${c.name} certification expires on ${new Date(c.expiryDate).toLocaleDateString()}`,
          module: "Fleet",
        });
      }
    });
  });

  const vehicles = getAllVehicles({ limit: 100 }).data;
  vehicles.forEach((v) => {
    if (v.registrationExpiry) {
      const regExpiry = new Date(v.registrationExpiry);
      const diffDays = Math.ceil((regExpiry - today) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        alerts.push({
          id: alertId++,
          type: "registration_expired",
          priority: "CRITICAL",
          entity: "Vehicle",
          entityName: `${v.plateNo} — ${v.brand} ${v.model}`,
          entityId: v.id,
          message: `Registration expired on ${regExpiry.toLocaleDateString()}`,
          module: "Fleet",
        });
      } else if (diffDays <= 60) {
        alerts.push({
          id: alertId++,
          type: "registration_expiring",
          priority: "WARNING",
          entity: "Vehicle",
          entityName: `${v.plateNo} — ${v.brand} ${v.model}`,
          entityId: v.id,
          message: `Registration expires on ${regExpiry.toLocaleDateString()} (${diffDays} days)`,
          module: "Fleet",
        });
      }
    }

    if (v.insuranceExpiry) {
      const insExpiry = new Date(v.insuranceExpiry);
      const diffDays = Math.ceil((insExpiry - today) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        alerts.push({
          id: alertId++,
          type: "insurance_expired",
          priority: "CRITICAL",
          entity: "Vehicle",
          entityName: `${v.plateNo} — ${v.brand} ${v.model}`,
          entityId: v.id,
          message: `Insurance expired on ${insExpiry.toLocaleDateString()}`,
          module: "Fleet",
        });
      } else if (diffDays <= 60) {
        alerts.push({
          id: alertId++,
          type: "insurance_expiring",
          priority: "WARNING",
          entity: "Vehicle",
          entityName: `${v.plateNo} — ${v.brand} ${v.model}`,
          entityId: v.id,
          message: `Insurance expires on ${insExpiry.toLocaleDateString()} (${diffDays} days)`,
          module: "Fleet",
        });
      }
    }

    if (v.nextMaintenance) {
      const maintDate = new Date(v.nextMaintenance);
      const diffDays = Math.ceil((maintDate - today) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        alerts.push({
          id: alertId++,
          type: "maintenance_overdue",
          priority: "CRITICAL",
          entity: "Vehicle",
          entityName: `${v.plateNo} — ${v.brand} ${v.model}`,
          entityId: v.id,
          message: `Maintenance overdue by ${Math.abs(diffDays)} days`,
          module: "Maintenance",
        });
      } else if (diffDays <= 14) {
        alerts.push({
          id: alertId++,
          type: "maintenance_due",
          priority: "WARNING",
          entity: "Vehicle",
          entityName: `${v.plateNo} — ${v.brand} ${v.model}`,
          entityId: v.id,
          message: `Maintenance due in ${diffDays} days`,
          module: "Maintenance",
        });
      }
    }

    if (v.nextMaintenanceOdometer && v.odometerReading >= v.nextMaintenanceOdometer) {
      alerts.push({
        id: alertId++,
        type: "mileage_exceeded",
        priority: "CRITICAL",
        entity: "Vehicle",
        entityName: `${v.plateNo} — ${v.brand} ${v.model}`,
        entityId: v.id,
        message: `Vehicle exceeded maintenance mileage (${v.odometerReading} / ${v.nextMaintenanceOdometer} km)`,
        module: "Maintenance",
      });
    }

    if (v.lastInspection) {
      const inspDate = new Date(v.lastInspection);
      const diffMonths = Math.ceil((today - inspDate) / (1000 * 60 * 60 * 24 * 30));
      if (diffMonths >= 6) {
        alerts.push({
          id: alertId++,
          type: "inspection_due",
          priority: "INFO",
          entity: "Vehicle",
          entityName: `${v.plateNo} — ${v.brand} ${v.model}`,
          entityId: v.id,
          message: `Safety inspection due (last: ${inspDate.toLocaleDateString()})`,
          module: "Fleet",
        });
      }
    }
  });

  return alerts;
}

export function getComplianceStats() {
  const alerts = getComplianceAlerts();
  const critical = alerts.filter((a) => a.priority === "CRITICAL").length;
  const warning = alerts.filter((a) => a.priority === "WARNING").length;
  const info = alerts.filter((a) => a.priority === "INFO").length;
  return { total: alerts.length, critical, warning, info };
}

export function getFilteredComplianceAlerts(filters = {}) {
  let alerts = getComplianceAlerts();
  if (filters.priority) alerts = alerts.filter((a) => a.priority === filters.priority);
  if (filters.module) alerts = alerts.filter((a) => a.module === filters.module);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    alerts = alerts.filter(
      (a) =>
        a.entityName.toLowerCase().includes(q) ||
        a.message.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q)
    );
  }
  return alerts;
}

export { PRIORITY_LEVELS };
