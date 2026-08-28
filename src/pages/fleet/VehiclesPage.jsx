import { useState, useEffect, useMemo } from "react";
import { Search, Plus, Eye, Edit3, Trash2, X, Truck, Gauge, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import TopNav from "../../components/dashboard/TopNav";
import Pagination from "../../components/shared/Pagination";
import ConfirmDialog from "../../components/shared/ConfirmDialog";
import { useToast } from "../../components/shared/Toast";
import OpsStatCard from "../../components/operations/OpsStatCard";
import { getAllVehicles, createVehicle, updateVehicle, updateOdometer, deleteVehicle, getVehicleStats, VEHICLE_STATUSES, VEHICLE_TYPES } from "../../services/fleet/vehicleService";
import { getAllDrivers } from "../../services/fleet/driverService";
import "../../styles/operations.css";

const STATUS_COLORS = {
  Available: { bg: "#DCFCE7", text: "#15803D" }, Assigned: { bg: "#EEF4FF", text: "#2455D6" },
  "On Trip": { bg: "#FEF3C7", text: "#92400E" }, Reserved: { bg: "#F3E8FF", text: "#7C3AED" },
  Maintenance: { bg: "#FEF2F2", text: "#B91C1C" }, Unavailable: { bg: "#F1F5F9", text: "#64748B" },
  Retired: { bg: "#F1F5F9", text: "#94A3BD" },
};

function StatusBadge({ status, colors = STATUS_COLORS }) {
  const c = colors[status] || colors.Available;
  return <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: c.bg, color: c.text }}>{status}</span>;
}

const inputStyle = { padding: "8px 12px", border: "1px solid var(--trackify-border)", borderRadius: 8, fontSize: 13, width: "100%", background: "#F8FAFD", color: "var(--trackify-text)" };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 4, display: "block" };

function VehicleForm({ vehicle, onSave, onCancel }) {
  const [form, setForm] = useState(vehicle || {
    plateNo: "", type: "Truck", brand: "", model: "", year: new Date().getFullYear(), color: "",
    capacityKg: "", odometerReading: 0, currentLocation: "", status: "Available",
    registrationExpiry: "", insuranceExpiry: "", nextMaintenance: "", nextMaintenanceOdometer: "",
  });
  const handleChange = (field) => (e) => {
    const val = e.target.type === "number" ? Number(e.target.value) : e.target.value;
    setForm((p) => ({ ...p, [field]: val }));
  };
  const handleSubmit = (e) => { e.preventDefault(); onSave(form); };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div><label style={labelStyle}>Plate Number *</label><input style={inputStyle} value={form.plateNo} onChange={handleChange("plateNo")} required placeholder="e.g. ABC 1234" /></div>
        <div><label style={labelStyle}>Vehicle Type *</label><select style={inputStyle} value={form.type} onChange={handleChange("type")}>{VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
        <div><label style={labelStyle}>Brand *</label><input style={inputStyle} value={form.brand} onChange={handleChange("brand")} required placeholder="e.g. Toyota" /></div>
        <div><label style={labelStyle}>Model *</label><input style={inputStyle} value={form.model} onChange={handleChange("model")} required placeholder="e.g. HiAce" /></div>
        <div><label style={labelStyle}>Year *</label><input style={inputStyle} type="number" value={form.year} onChange={handleChange("year")} required min="2000" max="2030" /></div>
        <div><label style={labelStyle}>Color</label><input style={inputStyle} value={form.color} onChange={handleChange("color")} placeholder="e.g. White" /></div>
        <div><label style={labelStyle}>Capacity (kg) *</label><input style={inputStyle} type="number" value={form.capacityKg} onChange={handleChange("capacityKg")} required min="0" /></div>
        <div><label style={labelStyle}>Odometer (km)</label><input style={inputStyle} type="number" value={form.odometerReading} onChange={handleChange("odometerReading")} min="0" /></div>
        <div><label style={labelStyle}>Current Location</label><input style={inputStyle} value={form.currentLocation} onChange={handleChange("currentLocation")} placeholder="e.g. Makati DC" /></div>
        <div><label style={labelStyle}>Status</label><select style={inputStyle} value={form.status} onChange={handleChange("status")}>{VEHICLE_STATUSES.filter((s) => s !== "Retired").map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
        <div><label style={labelStyle}>Registration Expiry</label><input style={inputStyle} type="date" value={form.registrationExpiry || ""} onChange={handleChange("registrationExpiry")} /></div>
        <div><label style={labelStyle}>Insurance Expiry</label><input style={inputStyle} type="date" value={form.insuranceExpiry || ""} onChange={handleChange("insuranceExpiry")} /></div>
        <div><label style={labelStyle}>Next Maintenance Date</label><input style={inputStyle} type="date" value={form.nextMaintenance || ""} onChange={handleChange("nextMaintenance")} /></div>
        <div><label style={labelStyle}>Next Maintenance Odometer</label><input style={inputStyle} type="number" value={form.nextMaintenanceOdometer || ""} onChange={handleChange("nextMaintenanceOdometer")} min="0" /></div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20, borderTop: "1px solid var(--trackify-border-soft)", paddingTop: 16 }}>
        <button type="button" onClick={onCancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--trackify-border)", background: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>Cancel</button>
        <button type="submit" style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "linear-gradient(90deg, #2455D6, #102F8A)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{vehicle ? "Update Vehicle" : "Add Vehicle"}</button>
      </div>
    </form>
  );
}

function OdometerModal({ vehicle, onClose, onSave }) {
  const [reading, setReading] = useState(vehicle.odometerReading);
  const [error, setError] = useState("");
  const handleSave = () => {
    if (reading < vehicle.odometerReading) { setError(`New reading cannot be less than current (${vehicle.odometerReading} km)`); return; }
    onSave(vehicle.id, reading);
  };
  return (
    <div className="ops-modal-overlay" onClick={onClose}>
      <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="ops-modal-header">
          <h3 className="ops-modal-title">Update Odometer — {vehicle.plateNo}</h3>
          <button className="ops-btn ops-btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ops-modal-body">
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "var(--trackify-text-secondary)", marginBottom: 4 }}>Current Odometer</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--trackify-text)" }}>{vehicle.odometerReading.toLocaleString()} km</div>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", display: "block", marginBottom: 4 }}>New Reading *</label>
            <input type="number" value={reading} onChange={(e) => { setReading(Number(e.target.value)); setError(""); }} style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--trackify-border)", borderRadius: 8, fontSize: 13 }} min={vehicle.odometerReading} />
          </div>
          {error && <div style={{ marginTop: 8, padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, fontSize: 12, color: "#B91C1C", display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={14} /> {error}</div>}
        </div>
        <div className="ops-modal-footer">
          <button className="ops-btn ops-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="ops-btn ops-btn-primary" onClick={handleSave}>Update</button>
        </div>
      </div>
    </div>
  );
}

function VehicleDetail({ vehicle, onBack, onEdit, onOdometerUpdate }) {
  if (!vehicle) return null;
  const DetailRow = ({ label, value }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--trackify-border-soft)", alignItems: "center" }}>
      <span style={{ fontSize: 12, color: "var(--trackify-text-secondary)" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--trackify-text)" }}>{value}</span>
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button className="ops-back-btn" onClick={onBack}><ChevronLeft size={15} /> Back</button>
        <div><h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{vehicle.plateNo}</h2><span style={{ fontSize: 13, color: "var(--trackify-text-secondary)" }}>{vehicle.brand} {vehicle.model} ({vehicle.year})</span></div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="ops-btn ops-btn-secondary" onClick={onOdometerUpdate}><Gauge size={14} /> Odometer</button>
          <button className="ops-btn ops-btn-primary" onClick={() => onEdit(vehicle)}><Edit3 size={14} /> Edit</button>
        </div>
      </div>
      <div className="ops-card" style={{ padding: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Vehicle Information</h4>
            <DetailRow label="Vehicle ID" value={`VH-${String(vehicle.id).padStart(4, "0")}`} />
            <DetailRow label="Plate Number" value={vehicle.plateNo} />
            <DetailRow label="Type" value={vehicle.type} />
            <DetailRow label="Brand" value={vehicle.brand} />
            <DetailRow label="Model" value={vehicle.model} />
            <DetailRow label="Year" value={vehicle.year} />
            <DetailRow label="Color" value={vehicle.color || "—"} />
            <DetailRow label="Capacity" value={`${vehicle.capacityKg?.toLocaleString()} kg`} />
            <DetailRow label="Ownership" value="Company Owned" />
          </div>
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Operational Information</h4>
            <DetailRow label="Status" value={<StatusBadge status={vehicle.status} />} />
            <DetailRow label="Assigned Driver" value={vehicle.assignedDriverId ? `DRV-${String(vehicle.assignedDriverId).padStart(4, "0")}` : "—"} />
            <DetailRow label="Current Assignment" value={vehicle.currentAssignment || "—"} />
            <DetailRow label="Current Location" value={vehicle.currentLocation || "—"} />
            <DetailRow label="Odometer" value={`${vehicle.odometerReading?.toLocaleString()} km`} />
          </div>
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Compliance</h4>
            <DetailRow label="Last Inspection" value={vehicle.lastInspection || "—"} />
            <DetailRow label="Last Maintenance" value={vehicle.lastMaintenance || "—"} />
            <DetailRow label="Next Maintenance" value={vehicle.nextMaintenance || "—"} />
            <DetailRow label="Reg. Expiry" value={vehicle.registrationExpiry || "—"} />
            <DetailRow label="Insurance Expiry" value={vehicle.insuranceExpiry || "—"} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VehiclesPage() {
  const [view, setView] = useState("list");
  const [data, setData] = useState({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
  const [stats, setStats] = useState({ total: 0, available: 0, assigned: 0, onTrip: 0, reserved: 0, maintenance: 0, unavailable: 0 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [odometerVehicle, setOdometerVehicle] = useState(null);
  const [deletingVehicle, setDeletingVehicle] = useState(null);
  const { addToast } = useToast();
  const driversData = useMemo(() => getAllDrivers({ limit: 100 }).data, []);

  const loadData = () => {
    setData(getAllVehicles({ search, status: statusFilter, type: typeFilter, page, limit: 10 }));
    setStats(getVehicleStats());
  };
  useEffect(() => { loadData(); }, [search, statusFilter, typeFilter, page]);

  const handleCreate = (d) => { createVehicle(d); addToast("Vehicle created successfully"); setView("list"); loadData(); };
  const handleUpdate = (d) => { updateVehicle(editingVehicle.id, d); addToast("Vehicle updated successfully"); setEditingVehicle(null); loadData(); };
  const handleOdometerSave = (id, reading) => {
    const r = updateOdometer(id, reading);
    if (r.success) { addToast("Odometer updated successfully"); setOdometerVehicle(null); loadData(); } else { addToast(r.message, "error"); }
  };
  const handleDelete = () => {
    const r = deleteVehicle(deletingVehicle.id);
    if (r.success) { addToast("Vehicle deleted successfully"); } else { addToast(r.message, "error"); }
    setDeletingVehicle(null);
    loadData();
  };

  return (
    <div className="ops-page">
      <TopNav />
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left"><h1 className="ops-title">Vehicle Registry</h1><p className="ops-subtitle">Manage and track all company vehicles</p></div>
          <div className="ops-header-actions"><button className="ops-btn ops-btn-primary" onClick={() => setView("create")}><Plus size={15} /> Add Vehicle</button></div>
        </div>
        <div className="ops-stats-bar">
          <OpsStatCard label="Total" count={stats.total} color="#071A4A" bg="#F1F5F9" />
          <OpsStatCard label="Available" count={stats.available} color="#15803D" bg="#DCFCE7" />
          <OpsStatCard label="Assigned" count={stats.assigned} color="#2455D6" bg="#EEF4FF" />
          <OpsStatCard label="On Trip" count={stats.onTrip} color="#92400E" bg="#FEF3C7" />
          <OpsStatCard label="Maintenance" count={stats.maintenance} color="#B91C1C" bg="#FEF2F2" />
          <OpsStatCard label="Unavailable" count={stats.unavailable} color="#94A3BD" bg="#F1F5F9" />
        </div>

        {view === "list" && (
          <div className="ops-card">
            <div className="ops-card-header" style={{ justifyContent: "space-between" }}>
              <div className="ops-search"><Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} /><input type="text" placeholder="Search vehicles..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: "auto", minWidth: 130 }}>
                  <option value="">All Statuses</option>
                  {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: "auto", minWidth: 130 }}>
                  <option value="">All Types</option>
                  {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="ops-table-wrapper">
              <table className="ops-table">
                <thead><tr><th>Vehicle</th><th>Type</th><th>Capacity</th><th>Odometer</th><th>Location</th><th>Status</th><th style={{ width: 100 }}>Actions</th></tr></thead>
                <tbody>
                  {data.data.length === 0 ? (
                    <tr><td colSpan={7}><div className="ops-empty"><Truck size={32} style={{ opacity: 0.3 }} /><div className="ops-empty-title">No vehicles found</div><div className="ops-empty-desc">{search || statusFilter || typeFilter ? "Try adjusting your filters" : "Add your first vehicle to get started"}</div></div></td></tr>
                  ) : data.data.map((v) => (
                    <tr key={v.id}>
                      <td><div style={{ fontWeight: 600, fontSize: 13, color: "var(--trackify-text)" }}>{v.plateNo}</div><div style={{ fontSize: 11, color: "var(--trackify-text-secondary)" }}>{v.brand} {v.model} ({v.year})</div></td>
                      <td style={{ fontSize: 13 }}>{v.type}</td>
                      <td style={{ fontSize: 13 }}>{v.capacityKg?.toLocaleString()} kg</td>
                      <td style={{ fontSize: 13 }}>{v.odometerReading?.toLocaleString()} km</td>
                      <td style={{ fontSize: 13 }}>{v.currentLocation}</td>
                      <td><StatusBadge status={v.status} /></td>
                      <td><div style={{ display: "flex", gap: 4 }}>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => { setSelectedVehicle(v); setView("details"); }} title="View"><Eye size={13} /></button>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setEditingVehicle(v)} title="Edit"><Edit3 size={13} /></button>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setOdometerVehicle(v)} title="Odometer"><Gauge size={13} /></button>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px", color: "#EF4444" }} onClick={() => setDeletingVehicle(v)} title="Delete"><Trash2 size={13} /></button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} perPage={data.limit} onPageChange={setPage} />
          </div>
        )}

        {view === "create" && <div className="ops-card" style={{ padding: 20 }}><h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Add New Vehicle</h3><VehicleForm onSave={handleCreate} onCancel={() => setView("list")} drivers={driversData} /></div>}
        {view === "details" && selectedVehicle && <VehicleDetail vehicle={data.data.find((v) => v.id === selectedVehicle.id) || selectedVehicle} onBack={() => setView("list")} onEdit={(v) => setEditingVehicle(v)} onOdometerUpdate={() => setOdometerVehicle(selectedVehicle)} />}

        {editingVehicle && (
          <div className="ops-modal-overlay" onClick={() => setEditingVehicle(null)}>
            <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
              <div className="ops-modal-header"><h3 className="ops-modal-title">Edit Vehicle — {editingVehicle.plateNo}</h3><button className="ops-btn ops-btn-ghost" onClick={() => setEditingVehicle(null)}><X size={18} /></button></div>
              <div className="ops-modal-body"><VehicleForm vehicle={editingVehicle} drivers={driversData} onSave={handleUpdate} onCancel={() => setEditingVehicle(null)} /></div>
            </div>
          </div>
        )}
        {odometerVehicle && <OdometerModal vehicle={odometerVehicle} onClose={() => setOdometerVehicle(null)} onSave={handleOdometerSave} />}
        <ConfirmDialog open={!!deletingVehicle} title="Delete Vehicle" message={`Are you sure you want to delete ${deletingVehicle?.plateNo}? This action cannot be undone.`} confirmLabel="Delete" danger onConfirm={handleDelete} onCancel={() => setDeletingVehicle(null)} />
      </div>
    </div>
  );
}
