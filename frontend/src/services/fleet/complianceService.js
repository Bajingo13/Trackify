import { get } from "../apiClient";

export const PRIORITY_LEVELS = ["CRITICAL", "WARNING", "INFO"];

const PRIORITY = { expired: "CRITICAL", expiring: "WARNING", valid: "INFO" };

function mapAlert(r, i) {
  const label = r.doc_type;
  const when = r.expiry_date ? new Date(r.expiry_date).toLocaleDateString() : "—";
  return {
    id: `${r.entity_type}-${r.entity_id}-${i}`,
    type: `${r.entity_type}_${label.toLowerCase().replace(/[^a-z]+/g, "_")}`,
    priority: PRIORITY[r.compliance_status] || "INFO",
    entity: r.entity_type === "driver" ? "Driver" : "Vehicle",
    entityName: r.entity_label,
    entityId: r.entity_id,
    message:
      r.days_to_expiry < 0
        ? `${label} expired on ${when}`
        : `${label} expires ${when} (${r.days_to_expiry} day${r.days_to_expiry === 1 ? "" : "s"})`,
    module: "Fleet",
    expiryDate: r.expiry_date,
    daysToExpiry: r.days_to_expiry,
  };
}

async function fetchAlerts() {
  const res = await get("/fleet/compliance?withinDays=120");
  return { alerts: (res.data || []).map(mapAlert), stats: res.stats || {} };
}

export async function getComplianceStats() {
  const { stats } = await fetchAlerts();
  return {
    total: stats.tracked || 0,
    critical: stats.expired || 0,
    warning: stats.expiring || 0,
    info: (stats.valid || 0),
  };
}

export async function getFilteredComplianceAlerts(filters = {}) {
  let { alerts } = await fetchAlerts();
  if (filters.priority) alerts = alerts.filter((a) => a.priority === filters.priority);
  if (filters.module) alerts = alerts.filter((a) => a.module === filters.module);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    alerts = alerts.filter(
      (a) => a.entityName.toLowerCase().includes(q) || a.message.toLowerCase().includes(q)
    );
  }
  return alerts;
}
