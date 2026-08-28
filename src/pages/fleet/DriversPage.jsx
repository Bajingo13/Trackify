import { useState, useEffect } from "react";
import { Search, Plus, Eye, Edit3, Trash2, X, User, ChevronLeft, Shield, AlertTriangle, CheckCircle2 } from "lucide-react";
import TopNav from "../../components/dashboard/TopNav";
import Pagination from "../../components/shared/Pagination";
import ConfirmDialog from "../../components/shared/ConfirmDialog";
import { useToast } from "../../components/shared/Toast";
import { getAllDrivers, createDriver, updateDriver, deleteDriver, getDriverStats, DRIVER_STATUSES, LICENSE_TYPES, getLicenseExpiryStatus } from "../../services/fleet/driverService";
import "../../styles/operations.css";

const STATUS_COLORS = {
  Available: { bg: "#DCFCE7", text: "#15803D" }, Assigned: { bg: "#EEF4FF", text: "#2455D6" },
  "On Trip": { bg: "#FEF3C7", text: "#92400E" }, "On Leave": { bg: "#F3E8FF", text: "#7C3AED" },
  Inactive: { bg: "#F1F5F9", text: "#94A3BD" },
};
const LICENSE_STATUS_COLORS = { "Valid": { bg: "#DCFCE7", text: "#15803D" }, "Expiring Soon": { bg: "#FEF3C7", text: "#92400E" }, "Expired": { bg: "#FEF2F2", text: "#B91C1C" } };

function StatusBadge({ status, colors = STATUS_COLORS }) {
  const c = colors[status] || colors.Available;
  return <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: c.bg, color: c.text }}>{status}</span>;
}

function LicenseBadge({ expiry }) {
  const status = getLicenseExpiryStatus(expiry);
  const c = LICENSE_STATUS_COLORS[status] || LICENSE_STATUS_COLORS.Valid;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text }}>{status}</span>;
}

const inputStyle = { padding: "8px 12px", border: "1px solid var(--trackify-border)", borderRadius: 8, fontSize: 13, width: "100%", background: "#F8FAFD" };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 4, display: "block" };

function DriverForm({ driver, onSave, onCancel }) {
  const [form, setForm] = useState(driver || { firstName: "", lastName: "", contactNo: "", licenseNo: "", licenseType: "Professional", licenseExpiry: "", status: "Available", emergencyContact: { name: "", phone: "", relationship: "" } });
  const handleChange = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.value }));
  const handleEmergency = (field) => (e) => setForm((p) => ({ ...p, emergencyContact: { ...p.emergencyContact, [field]: e.target.value } }));
  const handleSubmit = (e) => { e.preventDefault(); onSave(form); };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div><label style={labelStyle}>First Name *</label><input style={inputStyle} value={form.firstName} onChange={handleChange("firstName")} required /></div>
        <div><label style={labelStyle}>Last Name *</label><input style={inputStyle} value={form.lastName} onChange={handleChange("lastName")} required /></div>
        <div><label style={labelStyle}>Contact Number *</label><input style={inputStyle} value={form.contactNo} onChange={handleChange("contactNo")} required placeholder="+63 917 123 4567" /></div>
        <div><label style={labelStyle}>License Number *</label><input style={inputStyle} value={form.licenseNo} onChange={handleChange("licenseNo")} required /></div>
        <div><label style={labelStyle}>License Type</label><select style={inputStyle} value={form.licenseType} onChange={handleChange("licenseType")}>{LICENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
        <div><label style={labelStyle}>License Expiry *</label><input style={inputStyle} type="date" value={form.licenseExpiry || ""} onChange={handleChange("licenseExpiry")} required /></div>
        <div style={{ gridColumn: "span 2" }}><label style={labelStyle}>Status</label><select style={{ ...inputStyle, width: "auto" }} value={form.status} onChange={handleChange("status")}>{DRIVER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
      </div>
      <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-text-secondary)", marginTop: 20, marginBottom: 12, textTransform: "uppercase" }}>Emergency Contact</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <div><label style={labelStyle}>Name</label><input style={inputStyle} value={form.emergencyContact?.name || ""} onChange={handleEmergency("name")} /></div>
        <div><label style={labelStyle}>Phone</label><input style={inputStyle} value={form.emergencyContact?.phone || ""} onChange={handleEmergency("phone")} /></div>
        <div><label style={labelStyle}>Relationship</label><input style={inputStyle} value={form.emergencyContact?.relationship || ""} onChange={handleEmergency("relationship")} /></div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20, borderTop: "1px solid var(--trackify-border-soft)", paddingTop: 16 }}>
        <button type="button" onClick={onCancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--trackify-border)", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
        <button type="submit" style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "linear-gradient(90deg, #2455D6, #102F8A)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{driver ? "Update" : "Add Driver"}</button>
      </div>
    </form>
  );
}

function DriverDetail({ driver, onBack, onEdit }) {
  if (!driver) return null;
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
        <div><h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{driver.firstName} {driver.lastName}</h2><span style={{ fontSize: 13, color: "var(--trackify-text-secondary)" }}>DRV-{String(driver.id).padStart(4, "0")}</span></div>
        <div style={{ marginLeft: "auto" }}><button className="ops-btn ops-btn-primary" onClick={() => onEdit(driver)}><Edit3 size={14} /> Edit</button></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="ops-card" style={{ padding: 20 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 12, textTransform: "uppercase" }}>Personal Information</h4>
          <DetailRow label="Full Name" value={`${driver.firstName} ${driver.lastName}`} />
          <DetailRow label="Contact" value={driver.contactNo} />
          <DetailRow label="Status" value={<StatusBadge status={driver.status} />} />
          <DetailRow label="Assigned Vehicle" value={driver.assignedVehicleId ? `VH-${String(driver.assignedVehicleId).padStart(4, "0")}` : "—"} />
        </div>
        <div className="ops-card" style={{ padding: 20 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 12, textTransform: "uppercase" }}>License Information</h4>
          <DetailRow label="License No" value={driver.licenseNo} />
          <DetailRow label="License Type" value={driver.licenseType} />
          <DetailRow label="Expiry" value={driver.licenseExpiry} />
          <DetailRow label="Status" value={<LicenseBadge expiry={driver.licenseExpiry} />} />
        </div>
      </div>
      <div className="ops-card" style={{ padding: 20, marginTop: 16 }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 12, textTransform: "uppercase" }}>Certifications</h4>
        {(!driver.certifications || driver.certifications.length === 0) ? (
          <div style={{ fontSize: 13, color: "var(--trackify-text-muted)", padding: 16, textAlign: "center" }}>No certifications recorded</div>
        ) : (
          <table className="ops-table" style={{ margin: 0 }}>
            <thead><tr><th>Certification</th><th>Cert. No</th><th>Issue Date</th><th>Expiry Date</th><th>Authority</th><th>Status</th></tr></thead>
            <tbody>
              {driver.certifications.map((c, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</td>
                  <td style={{ fontSize: 13 }}>{c.certNo}</td>
                  <td style={{ fontSize: 13 }}>{c.issueDate}</td>
                  <td style={{ fontSize: 13 }}>{c.expiryDate}</td>
                  <td style={{ fontSize: 13 }}>{c.issuingAuthority}</td>
                  <td><StatusBadge status={c.status} colors={{ Valid: { bg: "#DCFCE7", text: "#15803D" }, Expired: { bg: "#FEF2F2", text: "#B91C1C" }, "Expiring Soon": { bg: "#FEF3C7", text: "#92400E" } }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {driver.emergencyContact && (
        <div className="ops-card" style={{ padding: 20, marginTop: 16 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 12, textTransform: "uppercase" }}>Emergency Contact</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <div><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Name</div><div style={{ fontSize: 13, fontWeight: 600 }}>{driver.emergencyContact.name}</div></div>
            <div><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Phone</div><div style={{ fontSize: 13, fontWeight: 600 }}>{driver.emergencyContact.phone}</div></div>
            <div><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Relationship</div><div style={{ fontSize: 13, fontWeight: 600 }}>{driver.emergencyContact.relationship}</div></div>
          </div>
        </div>
        )}
        <ConfirmDialog open={!!deletingDriver} title="Delete Driver" message={`Are you sure you want to delete ${deletingDriver?.firstName} ${deletingDriver?.lastName}? This action cannot be undone.`} confirmLabel="Delete" danger onConfirm={handleDelete} onCancel={() => setDeletingDriver(null)} />
      </div>
  );
}

export default function DriversPage() {
  const [view, setView] = useState("list");
  const [data, setData] = useState({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
  const [stats, setStats] = useState({ total: 0, available: 0, assigned: 0, onTrip: 0, onLeave: 0 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [editingDriver, setEditingDriver] = useState(null);
  const [deletingDriver, setDeletingDriver] = useState(null);
  const { addToast } = useToast();

  const loadData = () => {
    setData(getAllDrivers({ search, status: statusFilter, page, limit: 10 }));
    setStats(getDriverStats());
  };
  useEffect(() => { loadData(); }, [search, statusFilter, page]);

  const handleCreate = (d) => { createDriver(d); addToast("Driver added successfully"); setView("list"); loadData(); };
  const handleUpdate = (d) => { updateDriver(editingDriver.id, d); addToast("Driver updated successfully"); setEditingDriver(null); loadData(); };
  const handleDelete = () => {
    const r = deleteDriver(deletingDriver.id);
    if (r.success) { addToast("Driver deleted successfully"); } else { addToast(r.message, "error"); }
    setDeletingDriver(null);
    loadData();
  };

  return (
    <div className="ops-page">
      <TopNav />
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left"><h1 className="ops-title">Driver Management</h1><p className="ops-subtitle">Manage driver records, licenses, and certifications</p></div>
          <div className="ops-header-actions"><button className="ops-btn ops-btn-primary" onClick={() => setView("create")}><Plus size={15} /> Add Driver</button></div>
        </div>
        <div className="ops-stats-bar">
          {[
            { label: "Total", count: stats.total, color: "#071A4A" }, { label: "Available", count: stats.available, color: "#22C55E" },
            { label: "Assigned", count: stats.assigned, color: "#2455D6" }, { label: "On Trip", count: stats.onTrip, color: "#F59E0B" },
            { label: "On Leave", count: stats.onLeave, color: "#7C3AED" },
          ].map((s) => (
            <div key={s.label} className="ops-stat-pill">
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: s.color }} />{s.label}</span>
              <span className="ops-stat-count">{s.count}</span>
            </div>
          ))}
        </div>

        {view === "list" && (
          <div className="ops-card">
            <div className="ops-card-header" style={{ justifyContent: "space-between" }}>
              <div className="ops-search"><Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} /><input type="text" placeholder="Search drivers..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: "auto", minWidth: 130 }}>
                <option value="">All Statuses</option>
                {DRIVER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="ops-table-wrapper">
              <table className="ops-table">
                <thead><tr><th>Driver</th><th>Contact</th><th>License</th><th>License Status</th><th>Vehicle</th><th>Status</th><th style={{ width: 80 }}>Actions</th></tr></thead>
                <tbody>
                  {data.data.length === 0 ? (
                    <tr><td colSpan={7}><div className="ops-empty"><User size={32} style={{ opacity: 0.3 }} /><div className="ops-empty-title">No drivers found</div><div className="ops-empty-desc">{search || statusFilter ? "Try adjusting your filters" : "Add your first driver to get started"}</div></div></td></tr>
                  ) : data.data.map((d) => (
                    <tr key={d.id}>
                      <td><div style={{ fontWeight: 600, fontSize: 13 }}>{d.firstName} {d.lastName}</div><div style={{ fontSize: 11, color: "var(--trackify-text-secondary)" }}>DRV-{String(d.id).padStart(4, "0")}</div></td>
                      <td style={{ fontSize: 13 }}>{d.contactNo}</td>
                      <td style={{ fontSize: 13 }}>{d.licenseNo}</td>
                      <td><LicenseBadge expiry={d.licenseExpiry} /></td>
                      <td style={{ fontSize: 13 }}>{d.assignedVehicleId ? `VH-${String(d.assignedVehicleId).padStart(4, "0")}` : "—"}</td>
                      <td><StatusBadge status={d.status} /></td>
                      <td><div style={{ display: "flex", gap: 4 }}>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => { setSelectedDriver(d); setView("details"); }} title="View"><Eye size={13} /></button>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setEditingDriver(d)} title="Edit"><Edit3 size={13} /></button>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px", color: "#EF4444" }} onClick={() => setDeletingDriver(d)} title="Delete"><Trash2 size={13} /></button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} perPage={data.limit} onPageChange={setPage} />
          </div>
        )}

        {view === "create" && <div className="ops-card" style={{ padding: 20 }}><h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Add New Driver</h3><DriverForm onSave={handleCreate} onCancel={() => setView("list")} /></div>}
        {view === "details" && selectedDriver && <DriverDetail driver={data.data.find((d) => d.id === selectedDriver.id) || selectedDriver} onBack={() => setView("list")} onEdit={(d) => setEditingDriver(d)} />}
        {editingDriver && (
          <div className="ops-modal-overlay" onClick={() => setEditingDriver(null)}>
            <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
              <div className="ops-modal-header"><h3 className="ops-modal-title">Edit Driver</h3><button className="ops-btn ops-btn-ghost" onClick={() => setEditingDriver(null)}><X size={18} /></button></div>
              <div className="ops-modal-body"><DriverForm driver={editingDriver} onSave={handleUpdate} onCancel={() => setEditingDriver(null)} /></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
