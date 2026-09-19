import { useState, useEffect } from "react";
import AppShell from "../../components/layout/AppShell";
import { Search, Plus, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import Pagination from "../../components/shared/Pagination";
import OpsStatCard from "../../components/operations/OpsStatCard";
import { getFilteredComplianceAlerts, getComplianceStats, createComplianceDocument, uploadComplianceDocumentFile, PRIORITY_LEVELS } from "../../services/fleet/complianceService";
import { getAllDrivers } from "../../services/fleet/driverService";
import { getAllVehicles } from "../../services/fleet/vehicleService";
import { Button, Field, Modal, inputStyle as formInputStyle } from "../../components/ui";
import { Can, usePermissions } from "../../auth/permissions";
import { useToast } from "../../components/shared/Toast";
import StateBadge from "../../components/shared/StateBadge";
import "../../styles/operations.css";

const PRIORITY_STYLES = {
  CRITICAL: { tone: "danger", icon: AlertTriangle },
  WARNING: { tone: "warn", icon: AlertTriangle },
  INFO: { tone: "muted", icon: Info },
};

const EMPTY_DOCUMENT = {
  entityType: "driver", entityId: "", docType: "", docNumber: "",
  issueDate: "", expiryDate: "", reference: "", notes: "",
};

function ComplianceDocumentForm({ drivers, vehicles, loadingEntities, saving, onSave, onCancel }) {
  const [form, setForm] = useState(EMPTY_DOCUMENT);
  const options = form.entityType === "driver" ? drivers : vehicles;
  const set = (field) => (e) => setForm((current) => ({ ...current, [field]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    onSave({ ...form, entityId: Number(form.entityId) });
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "var(--s-4)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s-3)" }}>
        <Field label="Record for" required>
          <select
            style={formInputStyle}
            value={form.entityType}
            onChange={(e) => setForm((current) => ({ ...current, entityType: e.target.value, entityId: "" }))}
          >
            <option value="driver">Driver</option>
            <option value="vehicle">Vehicle</option>
          </select>
        </Field>
        <Field label={form.entityType === "driver" ? "Driver" : "Vehicle"} required>
          <select style={formInputStyle} value={form.entityId} onChange={set("entityId")} required disabled={loadingEntities}>
            <option value="">{loadingEntities ? "Loading…" : `Select ${form.entityType}`}</option>
            {options.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {form.entityType === "driver"
                  ? `${entity.firstName} ${entity.lastName}${entity.employeeNo ? ` — ${entity.employeeNo}` : ""}`
                  : `${entity.plateNo}${entity.type ? ` — ${entity.type}` : ""}`}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {!loadingEntities && options.length === 0 && (
        <p style={{ margin: 0, color: "var(--warn)", fontSize: "var(--fs-12)" }}>
          No accessible {form.entityType}s were found. Ask an administrator to grant the matching read permission.
        </p>
      )}

      <Field label="Document type" required hint="Examples: Safety Inspection, Emissions Test, Special Permit">
        <input style={formInputStyle} value={form.docType} onChange={set("docType")} required maxLength={80} list="compliance-document-types" />
        <datalist id="compliance-document-types">
          <option value="Safety Inspection" />
          <option value="Emissions Test" />
          <option value="Roadworthiness Certificate" />
          <option value="Special Permit" />
          <option value="Driver Certification" />
        </datalist>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s-3)" }}>
      {/* The certificate itself. Until now this form recorded that a document
          existed and when it lapsed, with nowhere to put the document. */}
      <Field label="The document itself" hint="Photo or PDF of the certificate. Optional — it can be attached later.">
        <input
          type="file"
          accept="image/*,application/pdf"
          style={formInputStyle}
          onChange={(e) => setForm((p) => ({ ...p, file: e.target.files?.[0] || null }))}
        />
      </Field>

        <Field label="Document number">
          <input style={formInputStyle} value={form.docNumber} onChange={set("docNumber")} maxLength={120} />
        </Field>
        <Field label="Reference">
          <input style={formInputStyle} value={form.reference} onChange={set("reference")} maxLength={255} />
        </Field>
        <Field label="Issue date">
          <input style={formInputStyle} type="date" value={form.issueDate} onChange={set("issueDate")} max={form.expiryDate || undefined} />
        </Field>
        <Field label="Expiry date" required>
          <input style={formInputStyle} type="date" value={form.expiryDate} onChange={set("expiryDate")} min={form.issueDate || undefined} required />
        </Field>
      </div>

      <Field label="Notes">
        <textarea style={{ ...formInputStyle, minHeight: 72, resize: "vertical" }} value={form.notes} onChange={set("notes")} maxLength={1000} />
      </Field>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--s-2)", paddingTop: "var(--s-3)", borderTop: "1px solid var(--line)" }}>
        <Button onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving} disabled={loadingEntities || options.length === 0}>Record document</Button>
      </div>
    </form>
  );
}

export default function CompliancePage() {
  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState({ total: 0, critical: 0, warning: 0, info: 0 });
  const [priorityFilter, setPriorityFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [documentOpen, setDocumentOpen] = useState(false);
  const [savingDocument, setSavingDocument] = useState(false);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const { addToast } = useToast();
  const { can } = usePermissions();
  const perPage = 10;

  const loadData = async () => {
    try {
      setAlerts(await getFilteredComplianceAlerts({ priority: priorityFilter, module: moduleFilter, search }));
      setStats(await getComplianceStats());
    } catch (e) { addToast(e.message || "Failed to load compliance records", "error"); }
  };
  useEffect(() => { loadData(); }, [priorityFilter, moduleFilter, search]);
  useEffect(() => { setPage(1); }, [priorityFilter, moduleFilter, search]);

  const total = alerts.length;
  const totalPages = Math.ceil(total / perPage);
  const paged = alerts.slice((page - 1) * perPage, page * perPage);

  const inputStyle = { padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, background: "var(--surface-2)", color: "var(--text)" };

  const openDocumentForm = async () => {
    setDocumentOpen(true);
    setLoadingEntities(true);
    const [driverResult, vehicleResult] = await Promise.allSettled([
      can("driver.read") ? getAllDrivers({ limit: 1000 }) : Promise.resolve({ data: [] }),
      can("vehicle.read") ? getAllVehicles({ limit: 1000 }) : Promise.resolve({ data: [] }),
    ]);
    setDrivers(driverResult.status === "fulfilled" ? driverResult.value.data : []);
    setVehicles(vehicleResult.status === "fulfilled" ? vehicleResult.value.data : []);
    setLoadingEntities(false);
  };

  const saveDocument = async (document) => {
    setSavingDocument(true);
    try {
      // The file rides with the form but is not part of the record, so it is
      // separated here and attached to the row once that row exists.
      const { file, ...fields } = document;
      const created = await createComplianceDocument(fields);
      const documentId = created?.data?.documentId ?? created?.documentId ?? null;

      if (file && documentId) {
        await uploadComplianceDocumentFile(documentId, file);
      }

      addToast(
        file && documentId
          ? "Compliance document recorded, with its file"
          : "Compliance document recorded",
        "success"
      );
      setDocumentOpen(false);
      await loadData();
    } catch (e) {
      addToast(e.message || "Failed to record compliance document", "error");
    } finally {
      setSavingDocument(false);
    }
  };

  return (
    <AppShell>
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left"><h1 className="ops-title">Fleet Compliance</h1><p className="ops-subtitle">Monitor compliance alerts and vehicle safety</p></div>
          <div className="ops-header-actions">
            <Can permission="compliance.manage">
              <button className="ops-btn ops-btn-primary" onClick={openDocumentForm}><Plus size={15} /> Record Document</button>
            </Can>
          </div>
        </div>
        <div className="ops-stats-bar">
          <OpsStatCard label="Total Alerts" count={stats.total} active={!priorityFilter && !moduleFilter}
            onClick={() => { setPriorityFilter(""); setModuleFilter(""); }} />
          <OpsStatCard label="Critical" count={stats.critical} active={priorityFilter === "CRITICAL"}
            onClick={() => setPriorityFilter((v) => (v === "CRITICAL" ? "" : "CRITICAL"))} />
          <OpsStatCard label="Warning" count={stats.warning} active={priorityFilter === "WARNING"}
            onClick={() => setPriorityFilter((v) => (v === "WARNING" ? "" : "WARNING"))} />
          <OpsStatCard label="Info" count={stats.info} active={priorityFilter === "INFO"}
            onClick={() => setPriorityFilter((v) => (v === "INFO" ? "" : "INFO"))} />
        </div>
        <div className="ops-card">
          <div className="ops-card-header" style={{ justifyContent: "space-between" }}>
            <div className="ops-search"><Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} /><input type="text" placeholder="Search alerts..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={{ ...inputStyle, minWidth: 120 }}>
                <option value="">All Priority</option>
                {PRIORITY_LEVELS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} style={{ ...inputStyle, minWidth: 120 }}>
                <option value="">All Modules</option>
                <option value="Fleet">Fleet</option>
                <option value="Maintenance">Maintenance</option>
              </select>
            </div>
          </div>
          <div style={{ padding: "12px 20px" }}>
            {paged.length === 0 ? (
              <div className="ops-empty" style={{ padding: 40 }}>
                <div style={{ width: 56, height: 56, borderRadius: "var(--r-md)", background: "var(--surface-sunk)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12, color: "var(--text-3)" }}>
                  <CheckCircle2 size={28} />
                </div>
                <div className="ops-empty-title">All Clear</div>
                <div className="ops-empty-desc">No compliance alerts at this time</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {paged.map((alert) => {
                  const ps = PRIORITY_STYLES[alert.priority] || PRIORITY_STYLES.INFO;
                  const Icon = ps.icon;
                  return (
                    <div key={alert.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>
                      <div style={{ width: 30, height: 30, borderRadius: "var(--r-xs)", background: "var(--surface-sunk)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--text-3)" }}>
                        <Icon size={14} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <StateBadge status={alert.priority} tone={ps.tone} />
                          <span style={{ fontSize: "var(--fs-11)", color: "var(--text-3)" }}>{alert.entity} · {alert.module}</span>
                        </div>
                        <div style={{ fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text)" }}>{alert.entityName}</div>
                        <div style={{ fontSize: "var(--fs-12)", color: "var(--text-2)", marginTop: 1 }}>{alert.message}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} perPage={perPage} onPageChange={setPage} />
        </div>

        <Modal open={documentOpen} onClose={() => !savingDocument && setDocumentOpen(false)} title="Record compliance document" width={620}>
          <ComplianceDocumentForm
            drivers={drivers}
            vehicles={vehicles}
            loadingEntities={loadingEntities}
            saving={savingDocument}
            onSave={saveDocument}
            onCancel={() => setDocumentOpen(false)}
          />
        </Modal>
      </div>
    </AppShell>
  );
}
