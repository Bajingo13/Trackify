import { useState, useEffect } from "react";
import AppShell from "../../components/layout/AppShell";
import { Search, Plus, Edit3, Trash2, X, Wrench, CheckCircle2, AlertTriangle } from "lucide-react";
import Pagination from "../../components/shared/Pagination";
import ConfirmDialog from "../../components/shared/ConfirmDialog";
import { useToast } from "../../components/shared/Toast";
import OpsStatCard from "../../components/operations/OpsStatCard";
import { getAllMaintenance, createMaintenance, updateMaintenance, getMaintenanceById, completeMaintenance, deleteMaintenance, getMaintenanceStats, MAINTENANCE_TYPES, MAINTENANCE_STATUSES } from "../../services/fleet/maintenanceService";
import { getAllVehicles } from "../../services/fleet/vehicleService";
import { getItems } from "../../services/warehouse/inventoryService";
import StateBadge from "../../components/shared/StateBadge";
import { Can } from "../../auth/permissions";
import "../../styles/operations.css";

const STATUS_COLORS = {
  Scheduled: { bg: "#EEF4FF", text: "#2455D6" }, Due: { bg: "#FEF3C7", text: "#92400E" },
  Overdue: { bg: "#FEF2F2", text: "#B91C1C" }, "In Progress": { bg: "#F3E8FF", text: "#7C3AED" },
  Completed: { bg: "#DCFCE7", text: "#15803D" }, Cancelled: { bg: "#F1F5F9", text: "#94A3BD" },
};

function StatusBadge({ status }) {
  return <StateBadge status={status} />;
}

const inputStyle = { padding: "8px 12px", border: "1px solid var(--trackify-border)", borderRadius: 8, fontSize: 13, width: "100%", background: "#F8FAFD" };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 4, display: "block" };

function MaintenanceForm({ record, vehicles, items, onSave, onCancel }) {
  const known = record && !MAINTENANCE_TYPES.includes(record.type);
  const alreadyCompleted = record?.status === "Completed";
  const [form, setForm] = useState(record
    ? { ...record, type: known ? "Other" : record.type, typeOther: known ? record.type : "", parts: record.parts?.map((p) => ({ itemId: p.itemId, quantity: p.quantity })) || [] }
    : { vehicleId: "", vehiclePlate: "", type: "Oil Change", typeOther: "", serviceDate: "", odometerAtService: "", technician: "", cost: "", parts: [], findings: "", status: "Scheduled", nextServiceDate: "", nextServiceOdometer: "", notes: "" });
  const handleChange = (field) => (e) => {
    const val = e.target.type === "number" ? Number(e.target.value) : e.target.value;
    const updates = { [field]: val };
    if (field === "vehicleId") { const v = vehicles.find((vh) => vh.id === Number(val)); if (v) updates.vehiclePlate = v.plateNo; }
    setForm((p) => ({ ...p, ...updates }));
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    const resolvedType = form.type === "Other" ? (form.typeOther || "").trim() : form.type;
    if (form.type === "Other" && !resolvedType) return;
    onSave({
      ...form,
      type: resolvedType,
      cost: form.cost ? Number(form.cost) : null,
      odometerAtService: form.odometerAtService ? Number(form.odometerAtService) : null,
      nextServiceOdometer: form.nextServiceOdometer ? Number(form.nextServiceOdometer) : null,
    });
  };
  const setPart = (i, patch) => setForm((p) => ({ ...p, parts: p.parts.map((row, idx) => (idx === i ? { ...row, ...patch } : row)) }));
  const addPart = () => setForm((p) => ({ ...p, parts: [...p.parts, { itemId: "", quantity: 1 }] }));
  const removePart = (i) => setForm((p) => ({ ...p, parts: p.parts.filter((_, idx) => idx !== i) }));

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div><label style={labelStyle}>Vehicle *</label><select style={inputStyle} value={form.vehicleId} onChange={handleChange("vehicleId")} required><option value="">Select vehicle</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.plateNo} — {v.brand} {v.model}</option>)}</select></div>
        <div>
          <label style={labelStyle}>Maintenance Type *</label>
          <select style={inputStyle} value={form.type} onChange={handleChange("type")}>{MAINTENANCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          {form.type === "Other" && (
            <input style={{ ...inputStyle, marginTop: 6 }} value={form.typeOther} onChange={handleChange("typeOther")} required placeholder="Specify the maintenance type" />
          )}
        </div>
        <div><label style={labelStyle}>Service Date *</label><input style={inputStyle} type="date" value={form.serviceDate || ""} onChange={handleChange("serviceDate")} required /></div>
        <div><label style={labelStyle}>Odometer at Service</label><input style={inputStyle} type="number" value={form.odometerAtService || ""} onChange={handleChange("odometerAtService")} min="0" /></div>
        <div><label style={labelStyle}>Technician</label><input style={inputStyle} value={form.technician} onChange={handleChange("technician")} placeholder="e.g. Mike's Auto Shop" /></div>
        <div><label style={labelStyle}>Cost (₱)</label><input style={inputStyle} type="number" value={form.cost || ""} onChange={handleChange("cost")} min="0" /></div>
        <div style={{ gridColumn: "span 2" }}>
          <label style={labelStyle}>Parts {alreadyCompleted ? "consumed" : "needed"}</label>
          {form.parts.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
              <select style={{ ...inputStyle, flex: 1 }} value={row.itemId} disabled={alreadyCompleted}
                onChange={(e) => setPart(i, { itemId: e.target.value })}>
                <option value="">— select a part —</option>
                {items.map((it) => <option key={it.itemId} value={it.itemId}>{it.itemId} — {it.name} ({it.totalQuantity} {it.unit} in stock)</option>)}
              </select>
              <input type="number" min="0.01" step="0.01" style={{ ...inputStyle, width: 90 }} value={row.quantity} disabled={alreadyCompleted}
                onChange={(e) => setPart(i, { quantity: Number(e.target.value) })} placeholder="Qty" />
              {!alreadyCompleted && (
                <button type="button" onClick={() => removePart(i)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#B91C1C", padding: 4 }}><X size={15} /></button>
              )}
            </div>
          ))}
          {!alreadyCompleted && (
            <button type="button" onClick={addPart} style={{ fontSize: 12, fontWeight: 600, color: "#2455D6", background: "transparent", border: "1px dashed #B5C8F5", borderRadius: 8, padding: "5px 10px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Plus size={13} /> Add part
            </button>
          )}
          {!alreadyCompleted && form.parts.length > 0 && (
            <p style={{ fontSize: 11, color: "var(--trackify-text-secondary)", marginTop: 4 }}>Deducted from the vehicle's home-branch stock when this job is marked Completed.</p>
          )}
        </div>
        <div style={{ gridColumn: "span 2" }}><label style={labelStyle}>Findings</label><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.findings} onChange={handleChange("findings")} /></div>
        <div><label style={labelStyle}>Status</label><select style={inputStyle} value={form.status} onChange={handleChange("status")}>{MAINTENANCE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
        <div><label style={labelStyle}>Next Service Date</label><input style={inputStyle} type="date" value={form.nextServiceDate || ""} onChange={handleChange("nextServiceDate")} /></div>
        <div><label style={labelStyle}>Next Service Odometer</label><input style={inputStyle} type="number" value={form.nextServiceOdometer || ""} onChange={handleChange("nextServiceOdometer")} min="0" /></div>
        <div><label style={labelStyle}>Notes</label><input style={inputStyle} value={form.notes} onChange={handleChange("notes")} /></div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20, borderTop: "1px solid var(--trackify-border-soft)", paddingTop: 16 }}>
        <button type="button" onClick={onCancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--trackify-border)", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
        <button type="submit" style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "linear-gradient(90deg, #2455D6, #102F8A)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{record ? "Update" : "Schedule Maintenance"}</button>
      </div>
    </form>
  );
}

export default function MaintenancePage() {
  const [view, setView] = useState("list");
  const [data, setData] = useState({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
  const [stats, setStats] = useState({ total: 0, scheduled: 0, overdue: 0, inProgress: 0, completed: 0 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [editingRecord, setEditingRecord] = useState(null);
  const [completingRecord, setCompletingRecord] = useState(null);
  const [deletingRecord, setDeletingRecord] = useState(null);
  const [completeForm, setCompleteForm] = useState({ cost: "", findings: "" });
  const [vehicles, setVehicles] = useState([]);
  const [items, setItems] = useState([]);
  const { addToast } = useToast();

  useEffect(() => { getAllVehicles({ limit: 200 }).then((r) => setVehicles(r.data)).catch(() => {}); }, []);
  useEffect(() => { getItems().then(setItems).catch(() => {}); }, []);

  const loadData = async () => {
    try {
      setData(await getAllMaintenance({ search, status: statusFilter, page, limit: 10 }));
      setStats(await getMaintenanceStats());
    } catch (e) { addToast(e.message || "Failed to load maintenance", "error"); }
  };
  useEffect(() => { loadData(); }, [search, statusFilter, page]);

  const handleCreate = async (f) => {
    try { await createMaintenance(f); addToast("Maintenance scheduled"); setView("list"); loadData(); }
    catch (e) { addToast(e.message || "Failed to schedule", "error"); }
  };
  const handleUpdate = async (f) => {
    try { await updateMaintenance(editingRecord.id, f); addToast("Maintenance updated"); setEditingRecord(null); loadData(); }
    catch (e) { addToast(e.message || "Update failed", "error"); }
  };
  const handleComplete = async () => {
    try {
      await completeMaintenance(completingRecord.id, completeForm);
      addToast("Maintenance completed");
      setCompletingRecord(null); setCompleteForm({ cost: "", findings: "" }); loadData();
    } catch (e) { addToast(e.message || "Failed", "error"); }
  };
  const handleDelete = async () => {
    const r = await deleteMaintenance(deletingRecord.id);
    if (r.success) { addToast("Maintenance record cancelled"); } else { addToast(r.message, "error"); }
    setDeletingRecord(null);
    loadData();
  };

  return (
    <AppShell>
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left"><h1 className="ops-title">Preventive Maintenance</h1><p className="ops-subtitle">Schedule and track vehicle maintenance</p></div>
          <div className="ops-header-actions"><Can permission="maintenance.manage"><button className="ops-btn ops-btn-primary" onClick={() => setView("create")}><Plus size={15} /> Schedule Maintenance</button></Can></div>
        </div>
        <div className="ops-stats-bar">
          <OpsStatCard label="Total" count={stats.total} active={!statusFilter}
            onClick={() => { setStatusFilter(""); setPage(1); }} />
          <OpsStatCard label="Scheduled" count={stats.scheduled} active={statusFilter === "Scheduled"}
            onClick={() => { setStatusFilter((v) => (v === "Scheduled" ? "" : "Scheduled")); setPage(1); }} />
          <OpsStatCard label="Overdue" count={stats.overdue} />
          <OpsStatCard label="In Progress" count={stats.inProgress} active={statusFilter === "In Progress"}
            onClick={() => { setStatusFilter((v) => (v === "In Progress" ? "" : "In Progress")); setPage(1); }} />
          <OpsStatCard label="Completed" count={stats.completed} active={statusFilter === "Completed"}
            onClick={() => { setStatusFilter((v) => (v === "Completed" ? "" : "Completed")); setPage(1); }} />
        </div>

        {view === "list" && (
          <div className="ops-card">
            <div className="ops-card-header" style={{ justifyContent: "space-between" }}>
              <div className="ops-search"><Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} /><input type="text" placeholder="Search maintenance..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: "auto", minWidth: 130 }}>
                <option value="">All Statuses</option>
                {MAINTENANCE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="ops-table-wrapper">
              <table className="ops-table">
                <thead><tr><th>Vehicle</th><th>Type</th><th>Service Date</th><th>Technician</th><th>Cost</th><th>Status</th><th style={{ width: 100 }}>Actions</th></tr></thead>
                <tbody>
                  {data.data.length === 0 ? (
                    <tr><td colSpan={7}><div className="ops-empty"><Wrench size={32} style={{ opacity: 0.3 }} /><div className="ops-empty-title">No maintenance records</div><div className="ops-empty-desc">{search || statusFilter ? "Try adjusting your filters" : "Schedule your first maintenance"}</div></div></td></tr>
                  ) : data.data.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{m.vehiclePlate}</td>
                      <td style={{ fontSize: 13 }}>{m.type}</td>
                      <td style={{ fontSize: 13 }}>{m.serviceDate}</td>
                      <td style={{ fontSize: 13 }}>{m.technician}</td>
                      <td style={{ fontSize: 13 }}>{m.cost ? `₱${m.cost.toLocaleString()}` : "—"}</td>
                      <td><StatusBadge status={m.status} /></td>
                      <td><Can permission="maintenance.manage" fallback={<span style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>—</span>}>
                        <div style={{ display: "flex", gap: 4 }}>
                          {m.status !== "Completed" && m.status !== "Cancelled" && (
                            <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => getMaintenanceById(m.id).then(setEditingRecord).catch(() => setEditingRecord(m))} title="Edit"><Edit3 size={13} /></button>
                          )}
                          {m.status !== "Completed" && m.status !== "Cancelled" && <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px", color: "#22C55E" }} onClick={() => { setCompleteForm({ cost: m.cost || "", findings: m.findings || "" }); getMaintenanceById(m.id).then(setCompletingRecord).catch(() => setCompletingRecord(m)); }} title="Complete"><CheckCircle2 size={13} /></button>}
                          {m.status !== "Cancelled" && <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px", color: "#EF4444" }} onClick={() => setDeletingRecord(m)} title="Cancel record"><Trash2 size={13} /></button>}
                        </div>
                      </Can></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} perPage={data.limit} onPageChange={setPage} />
          </div>
        )}

        {view === "create" && <div className="ops-card" style={{ padding: 20 }}><h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Schedule Maintenance</h3><MaintenanceForm vehicles={vehicles} items={items} onSave={handleCreate} onCancel={() => setView("list")} /></div>}

        {editingRecord && (
          <div className="ops-modal-overlay" onClick={() => setEditingRecord(null)}>
            <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
              <div className="ops-modal-header"><h3 className="ops-modal-title">Edit Maintenance</h3><button className="ops-btn ops-btn-ghost" onClick={() => setEditingRecord(null)}><X size={18} /></button></div>
              <div className="ops-modal-body"><MaintenanceForm record={editingRecord} vehicles={vehicles} items={items} onSave={handleUpdate} onCancel={() => setEditingRecord(null)} /></div>
            </div>
          </div>
        )}

        {completingRecord && (
          <div className="ops-modal-overlay" onClick={() => setCompletingRecord(null)}>
            <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
              <div className="ops-modal-header"><h3 className="ops-modal-title">Complete — {completingRecord.vehiclePlate}</h3><button className="ops-btn ops-btn-ghost" onClick={() => setCompletingRecord(null)}><X size={18} /></button></div>
              <div className="ops-modal-body">
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div><label style={labelStyle}>Cost (₱)</label><input type="number" value={completeForm.cost} onChange={(e) => setCompleteForm((p) => ({ ...p, cost: e.target.value }))} style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--trackify-border)", borderRadius: 8, fontSize: 13 }} /></div>
                  {completingRecord.parts?.length > 0 && (
                    <div>
                      <label style={labelStyle}>Parts to be consumed</label>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                        {completingRecord.parts.map((p, i) => <li key={i}>{p.quantity} {p.unit} — {p.name} ({p.itemId})</li>)}
                      </ul>
                      <p style={{ fontSize: 11, color: "var(--trackify-text-secondary)", margin: "4px 0 0" }}>Deducted from this vehicle's home-branch stock on completion. Insufficient stock will block completion.</p>
                    </div>
                  )}
                  <div><label style={labelStyle}>Findings</label><textarea value={completeForm.findings} onChange={(e) => setCompleteForm((p) => ({ ...p, findings: e.target.value }))} style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--trackify-border)", borderRadius: 8, fontSize: 13, minHeight: 80 }} /></div>
                </div>
              </div>
              <div className="ops-modal-footer">
                <button className="ops-btn ops-btn-secondary" onClick={() => setCompletingRecord(null)}>Cancel</button>
                <button className="ops-btn ops-btn-primary" onClick={handleComplete}>Mark Completed</button>
              </div>
            </div>
          </div>
        )}
        <ConfirmDialog open={!!deletingRecord} title="Delete Maintenance Record" message={`Are you sure you want to delete this ${deletingRecord?.type} record for ${deletingRecord?.vehiclePlate}? This action cannot be undone.`} confirmLabel="Delete" danger onConfirm={handleDelete} onCancel={() => setDeletingRecord(null)} />
      </div>
    </AppShell>
  );
}
