import { useState, useEffect } from "react";
import AppShell from "../../components/layout/AppShell";
import { Search, Plus, Eye, Edit3, Trash2, X, User, ChevronLeft, AlertTriangle, Smartphone, RotateCcw } from "lucide-react";
import Pagination from "../../components/shared/Pagination";
import ConfirmDialog from "../../components/shared/ConfirmDialog";
import { useToast } from "../../components/shared/Toast";
import OpsStatCard from "../../components/operations/OpsStatCard";
import { getAllDrivers, createDriver, updateDriver, deleteDriver, reactivateDriver, getDriverStats, setDriverAppAccess, DRIVER_STATUSES, LICENSE_TYPES, DEFAULT_LICENSE_TYPE } from "../../services/fleet/driverService";
import StateBadge from "../../components/shared/StateBadge";
import { Can } from "../../auth/permissions";
import { Button, Modal, Select } from "../../components/ui";
import { useRef } from "react";
import {
  getDriverLicensePhoto,
  uploadDriverLicensePhoto,
  deleteDriverLicensePhoto,
  scanDriverLicense,
} from "../../services/fleet/driverService";
import { prepareLicenceFile } from "../../services/fleet/prepareLicenceFile";
import { licenceExpiry, licenceExpiryBounds, licenceExpiryProblem } from "../../services/fleet/licenceExpiry";
import LicenseScanner from "../../components/fleet/LicenseScanner";
import { applyLicenseScan, licenceDifferences } from "../../components/fleet/applyLicenseScan";
import DriverRegistrationForm from "../../components/fleet/DriverRegistrationForm";

/**
 * The licence itself, beside the numbers describing it.
 *
 * Whether one is on file is discovered by asking for it: a driver without one
 * answers 404, which saves carrying a flag through the list query for
 * something only this panel ever looks at.
 *
 * Uploading a new licence also reads it. The photo is saved straight away, as
 * it always was; if what was read differs from the record (a renewal is the
 * usual reason) the differences are offered, side by side, to apply. Nothing
 * on the driver's record changes until the person says so.
 */
function LicencePhoto({ driver, onChanged }) {
  const driverId = driver.id;
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [offer, setOffer] = useState(null); // { diffs, nameNote, expired }
  const [reading, setReading] = useState(false);
  const fileRef = useRef(null);
  const { addToast } = useToast();

  useEffect(() => {
    let dead = false;
    setUrl(null);
    getDriverLicensePhoto(driverId)
      .then((u) => { if (!dead) setUrl(u); })
      .catch(() => { if (!dead) setUrl(null); });
    return () => { dead = true; };
  }, [driverId]);

  async function save(file, result) {
    if (!file) {
      // nothing could be opened, so there is nothing to keep
      addToast(result?.message || "That file could not be opened.", "error");
      return;
    }
    if (result?.status !== "read" || Number(result?.found || 0) < 1) {
      addToast(result?.message || "The licence is not readable. Upload a clearer photo before replacing the record.", "error");
      return;
    }
    setBusy(true);
    setErr("");
    setOffer(null);
    try {
      await uploadDriverLicensePhoto(driverId, file);
      setUrl(await getDriverLicensePhoto(driverId));
      const diffs = licenceDifferences(driver, result);
      const { nameNote } = applyLicenseScan(
        { firstName: driver.firstName, lastName: driver.lastName }, result
      );
      if (diffs.length || nameNote) {
        setOffer({ diffs, nameNote, scan: result });
      } else if (result?.status === "read") {
        addToast("Licence photo saved. The details on it match the record.");
      } else if (result?.message) {
        addToast(result.message, "error");
      }
      onChanged?.();
    } catch (ex) {
      setErr(ex.message || "That upload did not go through.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!offer?.diffs.length) { setOffer(null); return; }
    setBusy(true);
    setErr("");
    try {
      const patchBody = Object.fromEntries(offer.diffs.map((d) => [d.key, d.scanned]));
      await updateDriver(driverId, patchBody);
      addToast("Driver record updated from the licence");
      setOffer(null);
      onChanged?.();
    } catch (ex) {
      setErr(ex.message || "Could not update the record.");
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
      setOffer(null);
      onChanged?.();
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
              disabled={busy || reading} onClick={() => fileRef.current?.click()}>
              {reading ? "Reading…" : busy ? "Working…" : url ? "Replace" : "Upload"}
            </button>
            {url && (
              <button className="ops-btn ops-btn-ghost" style={{ padding: "5px 10px", fontSize: 12, color: "#EF4444" }}
                disabled={busy || reading} onClick={remove}>
                Remove
              </button>
            )}
          </span>
          {/* The scanner owns the file input: reading the licence and keeping the
              photo are one action. Its box is hidden here — this panel is already
              the place the photo lives — so only its result handling is used. */}
          <HiddenScanner driverId={driverId} inputRef={fileRef} onReading={setReading} onResult={save} />
        </Can>
      </div>

      {offer && (
        <div role="status" style={{ marginTop: 10, padding: 12, borderRadius: 8, border: "1px solid var(--warn-line)", background: "var(--warn-soft)", color: "var(--warn)", fontSize: 12, lineHeight: 1.5 }}>
          {offer.nameNote && <div style={{ marginBottom: offer.diffs.length ? 8 : 0 }}>{offer.nameNote}</div>}
          {offer.diffs.length > 0 && (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>The new licence differs from this driver's record:</div>
              <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 8 }}>
                <thead><tr style={{ textAlign: "left" }}><th style={{ padding: "2px 8px 2px 0" }}></th><th style={{ padding: "2px 8px" }}>On record</th><th style={{ padding: "2px 8px" }}>On the licence</th></tr></thead>
                <tbody>
                  {offer.diffs.map((d) => (
                    <tr key={d.key}>
                      <td style={{ padding: "2px 8px 2px 0", fontWeight: 600 }}>{d.label}</td>
                      <td style={{ padding: "2px 8px" }}>{d.current}</td>
                      <td style={{ padding: "2px 8px", fontWeight: 700 }}>{d.scanned}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="ops-btn ops-btn-primary" style={{ padding: "5px 12px", fontSize: 12 }} disabled={busy} onClick={apply}>
                  Update the record
                </button>
                <button className="ops-btn ops-btn-ghost" style={{ padding: "5px 12px", fontSize: 12 }} disabled={busy} onClick={() => setOffer(null)}>
                  Keep the record as it is
                </button>
              </div>
            </>
          )}
          {!offer.diffs.length && (
            <button className="ops-btn ops-btn-ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setOffer(null)}>Dismiss</button>
          )}
        </div>
      )}
      {err && <div style={{ marginTop: 6, fontSize: 12, color: "#B91C1C" }}>{err}</div>}
    </div>
  );
}

/**
 * A file input that reads the licence it is given and hands the file and the
 * result on. Used where the scanner's own box would be redundant.
 */
function HiddenScanner({ driverId, inputRef, onReading, onResult }) {
  async function pick(e) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    onReading(true);
    try {
      let file;
      try {
        file = await prepareLicenceFile(picked);
      } catch (ex) {
        onReading(false);
        await onResult(null, { status: "unsupported", message: ex.message });
        return;
      }
      let result;
      try {
        result = await scanDriverLicense(file, driverId);
      } catch (ex) {
        result = { status: "failed", message: ex.message || "The licence could not be read." };
      }
      onReading(false);
      await onResult(file, result);
    } finally {
      onReading(false);
    }
  }
  return <input ref={inputRef} type="file" accept="image/*,application/pdf" hidden aria-label="Licence photo" onChange={pick} />;
}
import "../../styles/operations.css";

const STATUS_COLORS = {
  Available: { bg: "#DCFCE7", text: "#15803D" }, Assigned: { bg: "#EEF4FF", text: "#2455D6" },
  "On Trip": { bg: "#FEF3C7", text: "#92400E" }, "On Leave": { bg: "#F3E8FF", text: "#7C3AED" },
  Inactive: { bg: "#F1F5F9", text: "#94A3BD" },
};
const LICENSE_STATUS_COLORS = { "Valid": { bg: "#DCFCE7", text: "#15803D" }, "Expiring Soon": { bg: "#FEF3C7", text: "#92400E" }, "Expired": { bg: "#FEF2F2", text: "#B91C1C" } };
const READ_MARK = { high: "var(--info)", low: "var(--warn)" };

function StatusBadge({ status }) {
  return <StateBadge status={status} />;
}

function UnusedStatusBadge({ status, colors = STATUS_COLORS }) {
  const c = colors[status] || colors.Available;
  return <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: c.bg, color: c.text }}>{status}</span>;
}

/**
 * Says how long, not only which bucket: "Expires in 12 days" tells the office
 * whether to chase today or next week, where "Expiring Soon" does not. A licence
 * that is simply fine stays quiet.
 */
function driverLicenseExpiry(driver) {
  const fallback = licenceExpiry(driver?.licenseExpiry);
  if (!driver?.licenseState) return fallback;
  const label = driver.licenseState === "expired" ? "Expired" : driver.licenseState === "expiring" ? "Expiring Soon" : "Valid";
  return { ...fallback, state: driver.licenseState, days: driver.licenseDaysLeft, label, text: driver.licenseExpiryText || fallback.text };
}

function LicenseBadge({ driver }) {
  const e = driverLicenseExpiry(driver);
  const c = LICENSE_STATUS_COLORS[e.label] || LICENSE_STATUS_COLORS.Valid;
  const text = e.state === "expired" || e.state === "expiring" ? e.text : e.state === "none" ? "No expiry" : "Valid";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span title={driver?.licenseExpiry ? `Expires ${driver.licenseExpiry}` : undefined} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text }}>{text}</span>
    </span>
  );
}

const inputStyle = { height: 34, padding: "6px 10px", border: "1px solid var(--line-strong)", borderRadius: 8, fontSize: 13, width: "100%", background: "var(--surface-2)", color: "var(--text)" };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 4, display: "block" };

function DriverForm({ driver, onSave, onCancel }) {
  const [form, setForm] = useState(driver ? { ...driver, licenseType: driver.licenseType || DEFAULT_LICENSE_TYPE } : { employeeNo: "", firstName: "", lastName: "", contactNo: "", licenseNo: "", licenseType: DEFAULT_LICENSE_TYPE, licenseExpiry: "", emergencyContact: { name: "", phone: "", relationship: "" } });
  // The scanned licence, kept to be saved with the driver; which fields came from
  // it (and how sure the reading was); and anything the person should be told.
  const [licenseFile, setLicenseFile] = useState(null);
  const [marks, setMarks] = useState({});
  const [scan, setScan] = useState(null);
  const [nameNote, setNameNote] = useState(null);

  // A value the person has typed over is theirs now: it stops being flagged as read from the card.
  const unmark = (field) => setMarks((m) => { if (!(field in m)) return m; const { [field]: _gone, ...rest } = m; return rest; });
  const handleChange = (field) => (e) => { const value = e.target.value; setForm((p) => ({ ...p, [field]: value })); unmark(field); };
  const handleEmergency = (field) => (e) => setForm((p) => ({ ...p, emergencyContact: { ...p.emergencyContact, [field]: e.target.value } }));
  const readableUpload = !licenseFile || (scan?.status === "read" && Number(scan?.found || 0) > 0);
  // A year no licence could have (2099 for 2029) is caught here, as the server
  // would — only once it is changed: a date already on file must not block an
  // edit to something else.
  const expiryChanged = String(form.licenseExpiry || "").slice(0, 10) !== String(driver?.licenseExpiry || "").slice(0, 10);
  const expiryProblem = expiryChanged ? licenceExpiryProblem(form.licenseExpiry) : null;
  const expiryBounds = licenceExpiryBounds();
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!readableUpload || expiryProblem) return;
    onSave(form, licenseFile);
  };

  // The scan takes seconds and the person may keep typing meanwhile, so the
  // result is applied to the form as it is NOW, not as it was when they chose
  // the photo — otherwise a name typed while it was reading would be overwritten.
  const latestForm = useRef(form);
  latestForm.current = form;

  function handleScanned(file, result) {
    setLicenseFile(file);
    setScan(result);
    const applied = applyLicenseScan(latestForm.current, result);
    setForm(applied.form);
    setMarks(applied.marks);
    setNameNote(applied.nameNote);
  }
  function handleCleared() {
    setLicenseFile(null);
    setScan(null);
    setMarks({});
    setNameNote(null);
  }

  /* An input, flagged when its value came off the licence: blue when the reading
     was clean, amber when the person should look twice. */
  const read = (field) => (marks[field]
    ? { ...inputStyle, borderColor: READ_MARK[marks[field]], boxShadow: `0 0 0 1px ${READ_MARK[marks[field]]}` }
    : inputStyle);
  const hint = (field) => marks[field] && (
    <span style={{ fontSize: 11, display: "block", marginTop: 4, color: READ_MARK[marks[field]], fontWeight: 600 }}>
      {marks[field] === "low" ? "Not sure about this one — check it against the card" : "Read from the licence"}
    </span>
  );
  const duplicate = scan?.duplicateOf && marks.licenseNo ? scan.duplicateOf : null;

  return (
    <form onSubmit={handleSubmit}>
      <Can permission="driver.manage">
        <LicenseScanner
          driverId={driver?.id}
          onScanned={handleScanned}
          onCleared={handleCleared}
          title="Scan driver's licence"
        />
      </Can>
      {nameNote && (
        <div role="alert" style={{ marginBottom: 14, padding: "8px 10px", borderRadius: 8, fontSize: 12, lineHeight: 1.45, background: "var(--warn-soft)", border: "1px solid var(--warn-line)", color: "var(--warn)" }}>{nameNote}</div>
      )}
      <div className="tk-modal-form-grid">
        <div><label style={labelStyle}>First Name *</label><input style={read("firstName")} value={form.firstName} onChange={handleChange("firstName")} required />{hint("firstName")}</div>
        <div><label style={labelStyle}>Last Name *</label><input style={read("lastName")} value={form.lastName} onChange={handleChange("lastName")} required />{hint("lastName")}</div>
        {/* The Driver App sign-in name. Assigned by the system when the driver was
            registered, and not editable: changing it would lock the driver out. */}
        <div>
          <span style={labelStyle}>Employee Number</span>
          <div aria-label="Employee Number" style={{ ...inputStyle, display: "flex", alignItems: "center", background: "var(--surface)", fontWeight: 600 }}>{form.employeeNo || "—"}</div>
          <span style={{ fontSize: 11, color: "var(--trackify-text-secondary)", display: "block", marginTop: 4 }}>
            Assigned by the system. The driver signs in with this and their PIN.
          </span>
        </div>
        <div><label style={labelStyle}>Contact Number *</label><input style={inputStyle} value={form.contactNo} onChange={handleChange("contactNo")} required placeholder="+63 917 123 4567" /></div>
        <div>
          <label style={labelStyle}>License Number *</label>
          <input style={read("licenseNo")} value={form.licenseNo} onChange={handleChange("licenseNo")} required />
          {hint("licenseNo")}
          {duplicate && <span role="alert" style={{ fontSize: 11, display: "block", marginTop: 4, color: "var(--danger)", fontWeight: 600 }}>Already belongs to {duplicate.name}</span>}
        </div>
        <div><label style={labelStyle}>License Type</label><Select value={form.licenseType} onChange={(v) => handleChange("licenseType")({ target: { value: v } })} options={LICENSE_TYPES.map((t) => ({ value: t, label: t }))} />{hint("licenseType")}</div>
        <div>
          <label style={labelStyle}>License Expiry *</label>
          <input style={read("licenseExpiry")} type="date" min={expiryChanged ? expiryBounds.min : undefined} max={expiryChanged ? expiryBounds.max : undefined} value={form.licenseExpiry || ""} onChange={handleChange("licenseExpiry")} required aria-invalid={Boolean(expiryProblem)} aria-label="License Expiry" />
          {hint("licenseExpiry")}
          {expiryProblem && <span role="alert" style={{ fontSize: 11, display: "block", marginTop: 4, fontWeight: 600, color: "var(--danger)" }}>{expiryProblem}</span>}
          {!expiryProblem && form.licenseExpiry && licenceExpiry(form.licenseExpiry).state !== "valid" && licenceExpiry(form.licenseExpiry).state !== "none" && (
            <span style={{ fontSize: 11, display: "block", marginTop: 4, fontWeight: 600, color: licenceExpiry(form.licenseExpiry).state === "expired" ? "var(--danger)" : "var(--warn)" }}>
              {licenceExpiry(form.licenseExpiry).text}
            </span>
          )}
        </div>
      </div>
      <h4 className="tk-modal-form-section-title" style={{ marginTop: "var(--s-4)" }}>Emergency Contact</h4>
      <div className="tk-modal-form-grid">
        <div><label style={labelStyle}>Name</label><input style={inputStyle} value={form.emergencyContact?.name || ""} onChange={handleEmergency("name")} /></div>
        <div><label style={labelStyle}>Phone</label><input style={inputStyle} value={form.emergencyContact?.phone || ""} onChange={handleEmergency("phone")} /></div>
        <div><label style={labelStyle}>Relationship</label><input style={inputStyle} value={form.emergencyContact?.relationship || ""} onChange={handleEmergency("relationship")} /></div>
      </div>
      <div className="tk-modal-form-actions">
        <Button variant="secondary" type="button" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!readableUpload || Boolean(expiryProblem)} title={!readableUpload ? "Upload a readable licence before saving" : expiryProblem ? "Check the licence expiry year" : undefined}>Update</Button>
      </div>
    </form>
  );
}

/**
 * What about a driver's licence the office has to act on, said at the top of its
 * card where nobody can miss it: that it has expired, or is about to. The office
 * is the only place a licence is entered or changed; the driver sees what is
 * recorded here, read-only, in the Driver App.
 */
function LicenceAlert({ driver }) {
  const e = driverLicenseExpiry(driver);
  const box = (bg, border, text) => ({ marginBottom: 12, padding: "10px 12px", borderRadius: 8, fontSize: 12, lineHeight: 1.5, background: bg, border: `1px solid ${border}`, color: text });
  return (
    <>
      {e.state === "expired" && (
        <div role="alert" style={box("var(--danger-soft)", "var(--danger-line)", "var(--danger)")}>
          <strong>Licence expired.</strong> {e.text}. This driver cannot be assigned to trips until a renewed licence is recorded.
        </div>
      )}
      {e.state === "expiring" && (
        <div role="status" style={box("var(--warn-soft)", "var(--warn-line)", "var(--warn)")}>
          <strong>{e.text}.</strong> Ask {driver.firstName} to renew it. The driver has been reminded in the app.
        </div>
      )}
    </>
  );
}


function DriverDetail({ driver, onBack, onEdit, onChanged }) {
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
          <LicenceAlert driver={driver} />
          <DetailRow label="License No" value={driver.licenseNo} />
          <DetailRow label="License Type" value={driver.licenseType} />
          <DetailRow label="Expiry" value={driver.licenseExpiry} />
          <DetailRow label="Status" value={<LicenseBadge driver={driver} />} />
          <LicencePhoto driver={driver} onChanged={onChanged} />
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
  const [stats, setStats] = useState({ total: 0, available: 0, onTrip: 0, inactive: 0, licence: { expired: 0, expiring: 0 } });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [licenseFilter, setLicenseFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [editingDriver, setEditingDriver] = useState(null);
  const [deletingDriver, setDeletingDriver] = useState(null);
  const [reactivatingDriver, setReactivatingDriver] = useState(null);
  const [pinDriver, setPinDriver] = useState(null);
  const { addToast } = useToast();

  const loadData = async () => {
    try {
      setData(await getAllDrivers({ search, status: statusFilter, licenseStatus: licenseFilter, page, limit: 10 }));
      setStats(await getDriverStats());
    } catch (e) { addToast(e.message || "Failed to load drivers", "error"); }
  };
  useEffect(() => { loadData(); }, [search, statusFilter, licenseFilter, page]);

  /*
   * The licence photo that was scanned in the form is saved once the driver
   * exists. If only that step fails the driver IS saved, and saying "failed to
   * add driver" would invite adding them twice — so it says which part failed.
   */
  const attachLicence = async (driverId, file) => {
    if (!file || !driverId) return true;
    try { await uploadDriverLicensePhoto(driverId, file); return true; }
    catch (e) {
      addToast(`The driver was saved, but the licence photo could not be attached: ${e.message || "upload failed"}. Open the driver to try again.`, "error");
      return false;
    }
  };
  const handleCreate = async (d, licenceFile) => {
    // The server reads the photo, checks the details against it and stores it with
    // the driver in one step. If it refuses, its reason says which detail is wrong.
    try {
      const res = await createDriver(d, licenceFile);
      const employeeNo = res?.data?.employeeNo;
      // The office has to hand this to the driver, with the PIN they just set.
      addToast(employeeNo
        ? `Driver saved as ${employeeNo}. They sign in to the Driver App with ${employeeNo} and the PIN you set.`
        : "Driver account, profile and verified licence saved", "success");
      setView("list"); loadData();
      return true;
    } catch (e) {
      addToast(e.message || "Failed to add driver", "error");
      return false;
    }
  };
  const handleUpdate = async (d, licenceFile) => {
    try {
      await updateDriver(editingDriver.id, d);
      if (await attachLicence(editingDriver.id, licenceFile)) addToast(licenceFile ? "Driver updated, with the new licence on file" : "Driver updated");
      setEditingDriver(null); loadData();
    } catch (e) { addToast(e.message || "Update failed", "error"); }
  };
  const handleReactivate = async () => {
    const d = reactivatingDriver;
    const r = await reactivateDriver(d.id);
    if (r.success) addToast(`${d.firstName} ${d.lastName} reactivated. They can sign in to the Driver App again and be assigned trips.`, "success");
    else addToast(r.message || "The driver could not be reactivated", "error");
    setReactivatingDriver(null);
    loadData();
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

        {/* Licences are what gets a driver grounded, so they lead the page when
            any need attention. Each count filters the list to those drivers. */}
        {(view === "list" || view === "create") && (stats.licence.expired + stats.licence.expiring) > 0 && (
          <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12, padding: "10px 14px", borderRadius: 10, fontSize: 13,
            background: stats.licence.expired ? "var(--danger-soft)" : "var(--warn-soft)", border: `1px solid ${stats.licence.expired ? "var(--danger-line)" : "var(--warn-line)"}`, color: stats.licence.expired ? "var(--danger)" : "var(--warn)" }}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <strong>Driver licences need attention:</strong>
            {[
              [stats.licence.expired, "expired", "Expired"],
              [stats.licence.expiring, "expiring within 60 days", "Expiring Soon"],
            ].filter(([n]) => n > 0).map(([n, text, filter]) => (
              <button key={filter} type="button" onClick={() => { setLicenseFilter(filter); setStatusFilter(""); setPage(1); }}
                style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", textDecoration: "underline", cursor: "pointer", fontWeight: licenseFilter === filter ? 700 : 500 }}>
                {n} {text}
              </button>
            ))}
          </div>
        )}

        {(view === "list" || view === "create") && (
          <div className="ops-card">
            <div className="ops-card-header" style={{ justifyContent: "space-between" }}>
              <div className="ops-search"><Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} /><input type="text" placeholder="Search drivers..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
              <div style={{ display: "flex", gap: 8 }}>
                <Select value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} style={{ width: "auto", minWidth: 120 }}
                  placeholder="All Statuses" options={[{ value: "", label: "All Statuses" }, ...DRIVER_STATUSES.map((s) => ({ value: s, label: s }))]} />
                <Select value={licenseFilter} onChange={(v) => { setLicenseFilter(v); setPage(1); }} style={{ width: "auto", minWidth: 130 }}
                  placeholder="All Licences" options={[
                    { value: "", label: "All Licences" },
                    { value: "Valid", label: "Licence valid" },
                    { value: "Expiring Soon", label: "Expiring soon" },
                    { value: "Expired", label: "Expired" },
                  ]} />
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
                      <td><LicenseBadge driver={d} /></td>
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
                          {d.status !== "Inactive"
                            ? <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px", color: "#EF4444" }} onClick={() => setDeletingDriver(d)} title="Deactivate"><Trash2 size={13} /></button>
                            : <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px", color: "var(--success)" }} onClick={() => setReactivatingDriver(d)} title="Reactivate" aria-label={`Reactivate ${d.firstName} ${d.lastName}`}><RotateCcw size={13} /></button>}
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

        {view === "create" && (
          <Modal open softBackdrop title="Add New Driver" onClose={() => setView("list")} width={720}>
            <DriverRegistrationForm onSave={handleCreate} onCancel={() => setView("list")} />
          </Modal>
        )}
        {view === "details" && selectedDriver && <DriverDetail driver={data.data.find((d) => d.id === selectedDriver.id) || selectedDriver} onBack={() => setView("list")} onEdit={(d) => setEditingDriver(d)} onChanged={loadData} />}
        {editingDriver && (
          <Modal open softBackdrop title="Edit Driver" onClose={() => setEditingDriver(null)} width={720}>
            <DriverForm driver={editingDriver} onSave={handleUpdate} onCancel={() => setEditingDriver(null)} />
          </Modal>
        )}
        <ConfirmDialog
          open={!!deletingDriver}
          softBackdrop
          title="Deactivate Driver"
          message={`Deactivate ${deletingDriver?.firstName} ${deletingDriver?.lastName}? They will no longer appear as available or be assignable to trips.`}
          confirmLabel="Deactivate"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeletingDriver(null)}
        />
        <ConfirmDialog
          open={!!reactivatingDriver}
          softBackdrop
          title="Reactivate Driver"
          message={`Reactivate ${reactivatingDriver?.firstName} ${reactivatingDriver?.lastName}${reactivatingDriver?.employeeNo ? ` (${reactivatingDriver.employeeNo})` : ""}? They keep their Employee Number and PIN, can sign in to the Driver App again, and can be assigned trips while their licence is valid.`}
          confirmLabel="Reactivate"
          onConfirm={handleReactivate}
          onCancel={() => setReactivatingDriver(null)}
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
    <div className="ops-modal-overlay soft-modal-backdrop" onClick={onClose}>
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
