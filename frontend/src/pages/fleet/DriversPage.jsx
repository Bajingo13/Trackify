import { useState, useEffect } from "react";
import AppShell from "../../components/layout/AppShell";
import { Search, Plus, Eye, Edit3, Trash2, X, User, ChevronLeft, Shield, AlertTriangle, CheckCircle2, Smartphone } from "lucide-react";
import Pagination from "../../components/shared/Pagination";
import ConfirmDialog from "../../components/shared/ConfirmDialog";
import { useToast } from "../../components/shared/Toast";
import OpsStatCard from "../../components/operations/OpsStatCard";
import { getAllDrivers, createDriver, updateDriver, deleteDriver, getDriverStats, setDriverAppAccess, DRIVER_STATUSES, LICENSE_TYPES, getLicenseExpiryStatus } from "../../services/fleet/driverService";
import StateBadge from "../../components/shared/StateBadge";
import { Can } from "../../auth/permissions";
import { useRef } from "react";
import {
  getDriverLicensePhoto,
  uploadDriverLicensePhoto,
  deleteDriverLicensePhoto,
} from "../../services/fleet/driverService";

/**
 * The licence itself, beside the numbers describing it.
 *
 * Whether one is on file is discovered by asking for it: a driver without one
 * answers 404, which saves carrying a flag through the list query for
 * something only this panel ever looks at.
 */
function LicencePhoto({ driverId }) {
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    let dead = false;
    setUrl(null);
    getDriverLicensePhoto(driverId)
      .then((u) => { if (!dead) setUrl(u); })
      .catch(() => { if (!dead) setUrl(null); });
    return () => { dead = true; };
  }, [driverId]);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      await uploadDriverLicensePhoto(driverId, file);
      setUrl(await getDriverLicensePhoto(driverId));
    } catch (ex) {
      setErr(ex.message || "That upload did not go through.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setErr("");
    try {
      await deleteDriverLicensePhoto(driverId);
      setUrl(null);
    } catch (ex) {
      setErr(ex.message || "Could not remove it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        {url ? (
          <img src={url} alt="Driver licence"
            style={{ width: 168, borderRadius: 8, border: "1px solid var(--trackify-border)" }} />
        ) : (
          <span style={{
            width: 168, height: 106, borderRadius: 8, display: "grid", placeItems: "center",
            border: "1px dashed var(--trackify-border)", fontSize: 12,
            color: "var(--trackify-text-muted, #64748b)", textAlign: "center", padding: 8,
          }}>
            No licence photo on file
          </span>
        )}

        <Can permission="driver.manage">
          <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button className="ops-btn ops-btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }}
              disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "Working…" : url ? "Replace" : "Upload"}
            </button>
            {url && (
              <button className="ops-btn ops-btn-ghost" style={{ padding: "5px 10px", fontSize: 12, color: "#EF4444" }}
                disabled={busy} onClick={remove}>
                Remove
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={pick} />
          </span>
        </Can>
      </div>
      {err && <div style={{ marginTop: 6, fontSize: 12, color: "#B91C1C" }}>{err}</div>}
    </div>
  );
}
import "../../styles/operations.css";

const STATUS_COLORS = {
  Available: { bg: "#DCFCE7", text: "#15803D" }, Assigned: { bg: "#EEF4FF", text: "#2455D6" },
  "On Trip": { bg: "#FEF3C7", text: "#92400E" }, "On Leave": { bg: "#F3E8FF", text: "#7C3AED" },
  Inactive: { bg: "#F1F5F9", text: "#94A3BD" },
};
const LICENSE_STATUS_COLORS = { "Valid": { bg: "#DCFCE7", text: "#15803D" }, "Expiring Soon": { bg: "#FEF3C7", text: "#92400E" }, "Expired": { bg: "#FEF2F2", text: "#B91C1C" } };

function StatusBadge({ status }) {
  return <StateBadge status={status} />;
}

function UnusedStatusBadge({ status, colors = STATUS_COLORS }) {
  const c = colors[status] || colors.Available;
  return <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: c.bg, color: c.text }}>{status}</span>;
}

function LicenseBadge({ expiry }) {
  const status = getLicenseExpiryStatus(expiry);
  const c = LICENSE_STATUS_COLORS[status] || LICENSE_STATUS_COLORS.Valid;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text }}>{status}</span>;
}

const inputStyle = { padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, width: "100%", background: "var(--surface-2)", color: "var(--text)" };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 4, display: "block" };

function DriverForm({ driver, onSave, onCancel }) {
  const [form, setForm] = useState(driver || { employeeNo: "", firstName: "", lastName: "", contactNo: "", licenseNo: "", licenseType: "Professional", licenseExpiry: "", emergencyContact: { name: "", phone: "", relationship: "" } });
  const handleChange = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.value }));
  const handleEmergency = (field) => (e) => setForm((p) => ({ ...p, emergencyContact: { ...p.emergencyContact, [field]: e.target.value } }));
  const handleSubmit = (e) => { e.preventDefault(); onSave(form); };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div><label style={labelStyle}>First Name *</label><input style={inputStyle} value={form.firstName} onChange={handleChange("firstName")} required /></div>
        <div><label style={labelStyle}>Last Name *</label><input style={inputStyle} value={form.lastName} onChange={handleChange("lastName")} required /></div>
        {/* This is the sign-in name for the Driver App. It had no field at all,
            while the screens displayed a number derived from the row id and
            told the office to hand it over — so it was never stored and the
            driver could not sign in. */}
        <div>
          <label style={labelStyle}>Employee Number</label>
          <input style={inputStyle} value={form.employeeNo || ""} onChange={handleChange("employeeNo")} placeholder="Leave blank for the next one" />
          <span style={{ fontSize: 11, color: "var(--trackify-text-secondary)", display: "block", marginTop: 4 }}>
            What the driver signs in with, together with their PIN.
          </span>
        </div>
        <div><label style={labelStyle}>Contact Number *</label><input style={inputStyle} value={form.contactNo} onChange={handleChange("contactNo")} required placeholder="+63 917 123 4567" /></div>
        <div><label style={labelStyle}>License Number *</label><input style={inputStyle} value={form.licenseNo} onChange={handleChange("licenseNo")} required /></div>
        <div><label style={labelStyle}>License Type</label><select style={inputStyle} value={form.licenseType} onChange={handleChange("licenseType")}>{LICENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
        <div><label style={labelStyle}>License Expiry *</label><input style={inputStyle} type="date" value={form.licenseExpiry || ""} onChange={handleChange("licenseExpiry")} required /></div>
      </div>
      <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-text-secondary)", marginTop: 20, marginBottom: 12, textTransform: "uppercase" }}>Emergency Contact</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <div><label style={labelStyle}>Name</label><input style={inputStyle} value={form.emergencyContact?.name || ""} onChange={handleEmergency("name")} /></div>
        <div><label style={labelStyle}>Phone</label><input style={inputStyle} value={form.emergencyContact?.phone || ""} onChange={handleEmergency("phone")} /></div>
        <div><label style={labelStyle}>Relationship</label><input style={inputStyle} value={form.emergencyContact?.relationship || ""} onChange={handleEmergency("relationship")} /></div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20, borderTop: "1px solid var(--trackify-border-soft)", paddingTop: 16 }}>
        <button type="button" onClick={onCancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--text)", fontSize: 13, cursor: "pointer" }}>Cancel</button>
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
        <div><h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{driver.firstName} {driver.lastName}</h2><span style={{ fontSize: 13, color: "var(--trackify-text-secondary)" }}>{driver.employeeNo || `DRV-${String(driver.id).padStart(3, "0")}`}</span></div>
        <Can permission="driver.manage">
          <div style={{ marginLeft: "auto" }}><button className="ops-btn ops-btn-primary" onClick={() => onEdit(driver)}><Edit3 size={14} /> Edit</button></div>
        </Can>
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
          <LicencePhoto driverId={driver.id} />
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
            {/* "Not recorded" rather than an empty line. Three blanks read as
                a system that lost the contact; naming the gap tells an admin
                there is something to go and ask the driver for. */}
            <div><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Name</div><div style={{ fontSize: 13, fontWeight: 600 }}>{driver.emergencyContact.name || <span style={{ fontWeight: 400, color: "var(--trackify-text-muted)" }}>Not recorded</span>}</div></div>
            <div><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Phone</div><div style={{ fontSize: 13, fontWeight: 600 }}>{driver.emergencyContact.phone || <span style={{ fontWeight: 400, color: "var(--trackify-text-muted)" }}>Not recorded</span>}</div></div>
            <div><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Relationship</div><div style={{ fontSize: 13, fontWeight: 600 }}>{driver.emergencyContact.relationship || <span style={{ fontWeight: 400, color: "var(--trackify-text-muted)" }}>Not recorded</span>}</div></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DriversPage() {
  const [view, setView] = useState("list");
  const [data, setData] = useState({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
  const [stats, setStats] = useState({ total: 0, available: 0, onTrip: 0, inactive: 0 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [licenseFilter, setLicenseFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [editingDriver, setEditingDriver] = useState(null);
  const [deletingDriver, setDeletingDriver] = useState(null);
  const [pinDriver, setPinDriver] = useState(null);
  const { addToast } = useToast();

  const loadData = async () => {
    try {
      setData(await getAllDrivers({ search, status: statusFilter, licenseStatus: licenseFilter, page, limit: 10 }));
      setStats(await getDriverStats());
    } catch (e) { addToast(e.message || "Failed to load drivers", "error"); }
  };
  useEffect(() => { loadData(); }, [search, statusFilter, licenseFilter, page]);

  const handleCreate = async (d) => {
    try { await createDriver(d); addToast("Driver added"); setView("list"); loadData(); }
    catch (e) { addToast(e.message || "Failed to add driver", "error"); }
  };
  const handleUpdate = async (d) => {
    try { await updateDriver(editingDriver.id, d); addToast("Driver updated"); setEditingDriver(null); loadData(); }
    catch (e) { addToast(e.message || "Update failed", "error"); }
  };
  const handleDelete = async () => {
    const r = await deleteDriver(deletingDriver.id);
    if (r.success) { addToast("Driver deactivated"); } else { addToast(r.message, "error"); }
    setDeletingDriver(null);
    loadData();
  };

  return (
    <AppShell>
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left"><h1 className="ops-title">Driver Management</h1><p className="ops-subtitle">Manage driver records, licenses, and certifications</p></div>
          <div className="ops-header-actions"><Can permission="driver.manage"><button className="ops-btn ops-btn-primary" onClick={() => setView("create")}><Plus size={15} /> Add Driver</button></Can></div>
        </div>
        <div className="ops-stats-bar">
          <OpsStatCard label="Total" count={stats.total} active={!statusFilter && !licenseFilter}
            onClick={() => { setStatusFilter(""); setLicenseFilter(""); setPage(1); }} />
          <OpsStatCard label="Available" count={stats.available} active={statusFilter === "Available"}
            onClick={() => { setStatusFilter((v) => (v === "Available" ? "" : "Available")); setPage(1); }} />
          <OpsStatCard label="On Trip" count={stats.onTrip} active={statusFilter === "On Trip"}
            onClick={() => { setStatusFilter((v) => (v === "On Trip" ? "" : "On Trip")); setPage(1); }} />
          <OpsStatCard label="Inactive" count={stats.inactive} active={statusFilter === "Inactive"}
            onClick={() => { setStatusFilter((v) => (v === "Inactive" ? "" : "Inactive")); setPage(1); }} />
        </div>

        {view === "list" && (
          <div className="ops-card">
            <div className="ops-card-header" style={{ justifyContent: "space-between" }}>
              <div className="ops-search"><Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} /><input type="text" placeholder="Search drivers..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: "auto", minWidth: 120 }}>
                  <option value="">All Statuses</option>
                  {DRIVER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={licenseFilter} onChange={(e) => { setLicenseFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: "auto", minWidth: 130 }}>
                  <option value="">All Licences</option>
                  <option value="Valid">Licence valid</option>
                  <option value="Expiring Soon">Expiring soon</option>
                  <option value="Expired">Expired</option>
                </select>
              </div>
            </div>
            <div className="ops-table-wrapper">
              <table className="ops-table">
                <thead><tr><th>Driver</th><th>Contact</th><th>License</th><th>License Status</th><th>App</th><th>Status</th><th style={{ width: 110 }}>Actions</th></tr></thead>
                <tbody>
                  {data.data.length === 0 ? (
                    <tr><td colSpan={7}><div className="ops-empty"><User size={32} style={{ opacity: 0.3 }} /><div className="ops-empty-title">No drivers found</div><div className="ops-empty-desc">{search || statusFilter ? "Try adjusting your filters" : "Add your first driver to get started"}</div></div></td></tr>
                  ) : data.data.map((d) => (
                    <tr key={d.id}>
                      <td><div style={{ fontWeight: 600, fontSize: 13 }}>{d.firstName} {d.lastName}</div><div style={{ fontSize: 11, color: "var(--trackify-text-secondary)" }}>{d.employeeNo || `DRV-${String(d.id).padStart(3, "0")}`}</div></td>
                      <td style={{ fontSize: 13 }}>{d.contactNo}</td>
                      <td style={{ fontSize: 13 }}>{d.licenseNo}</td>
                      <td><LicenseBadge expiry={d.licenseExpiry} /></td>
                      <td>
                        {d.appEnabled && d.hasPin
                          ? <span style={{ fontSize: 11, fontWeight: 600, color: "#15803D", background: "#DCFCE7", padding: "2px 8px", borderRadius: 6 }}>Enabled</span>
                          : <span style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>—</span>}
                      </td>
                      <td><StatusBadge status={d.status} /></td>
                      <td><div style={{ display: "flex", gap: 4 }}>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => { setSelectedDriver(d); setView("details"); }} title="View"><Eye size={13} /></button>
                        <Can permission="driver.manage">
                          <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setPinDriver(d)} title="Driver App PIN"><Smartphone size={13} /></button>
                          <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setEditingDriver(d)} title="Edit"><Edit3 size={13} /></button>
                          {d.status !== "Inactive" && <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px", color: "#EF4444" }} onClick={() => setDeletingDriver(d)} title="Deactivate"><Trash2 size={13} /></button>}
                        </Can>
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
        <ConfirmDialog
          open={!!deletingDriver}
          title="Deactivate Driver"
          message={`Deactivate ${deletingDriver?.firstName} ${deletingDriver?.lastName}? They will no longer appear as available or be assignable to trips.`}
          confirmLabel="Deactivate"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeletingDriver(null)}
        />
        {pinDriver && (
          <PinModal
            driver={pinDriver}
            onClose={() => setPinDriver(null)}
            onSaved={() => { setPinDriver(null); loadData(); }}
            addToast={addToast}
          />
        )}
      </div>
    </AppShell>
  );
}

function PinModal({ driver, onClose, onSaved, addToast }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!/^\d{4,6}$/.test(pin)) { addToast("PIN must be 4 to 6 digits", "error"); return; }
    setBusy(true);
    try {
      await setDriverAppAccess(driver.id, { pin });
      addToast(`Driver App PIN set for ${driver.firstName}`, "success");
      onSaved();
    } catch (e) { addToast(e.message || "Failed to set PIN", "error"); }
    finally { setBusy(false); }
  }

  async function toggle() {
    setBusy(true);
    try {
      await setDriverAppAccess(driver.id, { appEnabled: !driver.appEnabled });
      addToast(`Driver App ${driver.appEnabled ? "disabled" : "enabled"}`, "success");
      onSaved();
    } catch (e) { addToast(e.message || "Failed", "error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="ops-modal-overlay" onClick={onClose}>
      <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="ops-modal-header">
          <h3 className="ops-modal-title">Driver App — {driver.firstName} {driver.lastName}</h3>
          <button className="ops-btn ops-btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ops-modal-body">
          <p style={{ fontSize: 13, color: "var(--trackify-text-secondary)", marginBottom: 12 }}>
            The driver signs in at <b>/driver</b> with their employee number (<b>{driver.employeeNo || `DRV-${String(driver.id).padStart(3, "0")}`}</b>) and this PIN.
            {driver.hasPin ? " A PIN is already set — entering a new one replaces it." : ""}
          </p>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", display: "block", marginBottom: 4 }}>New PIN (4–6 digits)</label>
          <input
            style={{ padding: "10px 12px", border: "1px solid var(--trackify-border)", borderRadius: 8, fontSize: 18, width: "100%", letterSpacing: "0.3em", textAlign: "center" }}
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="••••"
          />
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            {driver.hasPin && (
              <button className="ops-btn ops-btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={toggle}>
                {driver.appEnabled ? "Disable app access" : "Enable app access"}
              </button>
            )}
            <button className="ops-btn ops-btn-primary" style={{ flex: 1 }} disabled={busy || pin.length < 4} onClick={save}>
              {busy ? "Saving…" : "Set PIN"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
