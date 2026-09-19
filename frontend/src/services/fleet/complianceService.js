import { get, post, postForm } from "../apiClient";

export const PRIORITY_LEVELS = ["CRITICAL", "WARNING", "INFO"];

const PRIORITY = { expired: "CRITICAL", expiring: "WARNING", valid: "INFO" };

/**
 * The certificate itself, attached to the row that records its expiry.
 *
 * One file per document, because the row is the document — uploading again is
 * what renewing a certificate means, and it replaces what was there.
 */
export function uploadComplianceDocumentFile(documentId, file) {
  const form = new FormData();
  form.append("file", file, file.name || "document");
  return postForm(`/fleet/compliance/documents/${documentId}/file`, form);
}

/** Vehicle roadworthiness records belong to Maintenance; legal identity and
 * registration records stay under Fleet. This keeps the page's module filter
 * tied to the document itself instead of labelling every row "Fleet". */
export function moduleForComplianceDocument(docType) {
  return /(?:inspection|emission|roadworth|road worth|safety|fitness|maintenance)/i.test(String(docType || ""))
    ? "Maintenance"
    : "Fleet";
}

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
    module: moduleForComplianceDocument(label),
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

export async function createComplianceDocument(data) {
  return post("/fleet/compliance/documents", data);
}
