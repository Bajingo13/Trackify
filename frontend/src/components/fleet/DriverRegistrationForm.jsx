import { useRef, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button, Select } from "../ui";
import LicenseScanner from "./LicenseScanner";
import { applyLicenseScan } from "./applyLicenseScan";
import { DEFAULT_LICENSE_TYPE, LICENSE_TYPES } from "../../services/fleet/driverService";
import { licenceExpiry, licenceExpiryBounds, licenceExpiryProblem, licenceKey } from "../../services/fleet/licenceExpiry";

const inputStyle = { height: 40, padding: "8px 11px", border: "1px solid var(--line-strong)", borderRadius: 8, fontSize: 13, width: "100%", background: "var(--surface-2)", color: "var(--text)" };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 4, display: "block" };
const readColour = { high: "var(--info)", low: "var(--warn)" };
// The server's own check (fieldChecks.js) has the last word; this only keeps Save shut on an obvious typo.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const initialForm = () => ({
  firstName: "", lastName: "", contactNo: "", email: "",
  licenseNo: "", licenseType: DEFAULT_LICENSE_TYPE, licenseExpiry: "",
  emergencyContact: { name: "", phone: "", relationship: "" },
});

export default function DriverRegistrationForm({ onSave, onCancel }) {
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [licenseFile, setLicenseFile] = useState(null);
  const [scan, setScan] = useState(null);
  const [marks, setMarks] = useState({});
  const [nameNote, setNameNote] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const latestForm = useRef(form);
  latestForm.current = form;

  const change = (field, { reviewSensitive = false } = {}) => (e) => {
    const value = e.target.value;
    setForm((old) => ({ ...old, [field]: value }));
    setMarks((old) => {
      if (!(field in old)) return old;
      const { [field]: _removed, ...rest } = old;
      return rest;
    });
    if (reviewSensitive) setReviewed(false);
    setError("");
  };
  const changeEmergency = (field) => (e) => setForm((old) => ({
    ...old, emergencyContact: { ...old.emergencyContact, [field]: e.target.value },
  }));

  function scanned(file, result) {
    setLicenseFile(file);
    setScan(result);
    setReviewed(false);
    const applied = applyLicenseScan(latestForm.current, result);
    setForm(applied.form);
    setMarks(applied.marks);
    setNameNote(applied.nameNote);
  }

  function clearScan() {
    setLicenseFile(null);
    setScan(null);
    setMarks({});
    setNameNote(null);
    setReviewed(false);
  }

  const readable = Boolean(licenseFile && scan?.status === "read" && Number(scan.found || 0) > 0);
  const requiredComplete = Boolean(
    form.firstName.trim() && form.lastName.trim() && form.contactNo.trim()
      && EMAIL.test(form.email.trim())
      && form.licenseNo.trim() && form.licenseExpiry
  );
  // Compared as the server compares: "N01-12-345678" and "n01 12 345678" are one licence.
  const duplicate = scan?.duplicateOf && licenceKey(scan.fields?.licenseNo) === licenceKey(form.licenseNo)
    ? scan.duplicateOf : null;
  // The Employee Number is not asked for: the system assigns the next one when
  // the driver is saved, so it is always unique and never mistyped.
  // a year no licence could have (2099 for 2029) is caught here, as the server would
  const expiryProblem = licenceExpiryProblem(form.licenseExpiry);
  const expiryBounds = licenceExpiryBounds();
  const ready = readable && requiredComplete && !duplicate && !expiryProblem && reviewed;

  async function submit(e) {
    e.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await onSave({ ...form, licenseReviewed: true }, licenseFile);
      if (saved === false) setSaving(false);
    } catch (ex) {
      setError(ex.message || "The driver could not be saved.");
      setSaving(false);
    }
  }

  const readStyle = (field) => marks[field]
    ? { ...inputStyle, borderColor: readColour[marks[field]], boxShadow: `0 0 0 1px ${readColour[marks[field]]}` }
    : inputStyle;
  const hint = (field) => marks[field] && (
    <span style={{ fontSize: 11, display: "block", marginTop: 4, color: readColour[marks[field]], fontWeight: 600 }}>
      {marks[field] === "low" ? "OCR is unsure — verify this value" : "Extracted from the licence"}
    </span>
  );

  return (
    <form onSubmit={submit} noValidate>
      <LicenseScanner onScanned={scanned} onCleared={clearScan} title="Driver's licence photo or scan (required)" />
      {nameNote && <div role="alert" style={{ marginBottom: 14, padding: "8px 10px", borderRadius: 8, fontSize: 12, lineHeight: 1.45, background: "var(--warn-soft)", border: "1px solid var(--warn-line)", color: "var(--warn)" }}>{nameNote}</div>}

      <div className="tk-modal-form-grid">
        <div><label style={labelStyle} htmlFor="new-driver-first-name">First Name *</label><input id="new-driver-first-name" style={readStyle("firstName")} value={form.firstName} onChange={change("firstName", { reviewSensitive: true })} required />{hint("firstName")}</div>
        <div><label style={labelStyle} htmlFor="new-driver-last-name">Last Name *</label><input id="new-driver-last-name" style={readStyle("lastName")} value={form.lastName} onChange={change("lastName", { reviewSensitive: true })} required />{hint("lastName")}</div>
        <div><label style={labelStyle} htmlFor="new-driver-contact">Contact Number *</label><input id="new-driver-contact" style={inputStyle} value={form.contactNo} onChange={change("contactNo")} required placeholder="+63 917 123 4567" /></div>
        <div>
          <label style={labelStyle} htmlFor="new-driver-email">Email (Gmail) *</label>
          <input id="new-driver-email" type="email" style={inputStyle} value={form.email} onChange={change("email")} required placeholder="juan.delacruz@gmail.com" autoComplete="off" />
          <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--trackify-text-muted)", lineHeight: 1.4 }}>
            The Driver App sends a one-time sign-in code here.
          </div>
        </div>
        <div>
          <label style={labelStyle} htmlFor="new-driver-license-no">License Number *</label>
          <input id="new-driver-license-no" style={readStyle("licenseNo")} value={form.licenseNo} onChange={change("licenseNo", { reviewSensitive: true })} required />
          {hint("licenseNo")}
          {duplicate && <span role="alert" style={{ fontSize: 11, display: "block", marginTop: 4, color: "var(--danger)", fontWeight: 600 }}>
            Already belongs to {duplicate.name}{duplicate.employeeNo ? ` (${duplicate.employeeNo})` : ""}{duplicate.inactive ? ", who is inactive. Reactivate them from the driver list instead." : ""}
          </span>}
        </div>
        <div><label style={labelStyle}>License Type</label><Select value={form.licenseType} onChange={(value) => change("licenseType", { reviewSensitive: true })({ target: { value } })} options={LICENSE_TYPES.map((value) => ({ value, label: value }))} />{hint("licenseType")}</div>
        <div>
          <label style={labelStyle} htmlFor="new-driver-license-expiry">License Expiry *</label>
          <input id="new-driver-license-expiry" style={readStyle("licenseExpiry")} type="date" min={expiryBounds.min} max={expiryBounds.max} value={form.licenseExpiry} onChange={change("licenseExpiry", { reviewSensitive: true })} required aria-invalid={Boolean(expiryProblem)} />
          {hint("licenseExpiry")}
          {expiryProblem && <span role="alert" style={{ fontSize: 11, display: "block", marginTop: 4, fontWeight: 600, color: "var(--danger)" }}>{expiryProblem}</span>}
          {!expiryProblem && form.licenseExpiry && licenceExpiry(form.licenseExpiry).state !== "valid" && <span style={{ fontSize: 11, display: "block", marginTop: 4, fontWeight: 600, color: licenceExpiry(form.licenseExpiry).state === "expired" ? "var(--danger)" : "var(--warn)" }}>{licenceExpiry(form.licenseExpiry).text}</span>}
        </div>
      </div>

      {/* Account access: how the driver signs in to the Driver App. Under the
          licence because it is set up with the driver's record, in one save. */}
      <h4 className="tk-modal-form-section-title" style={{ marginTop: "var(--s-4)", display: "flex", alignItems: "center", gap: 6 }}>
        <KeyRound size={15} /> Account Access
      </h4>
      <div className="tk-modal-form-grid">
        <div>
          <span style={labelStyle}>Employee Number</span>
          <div aria-label="Employee Number" style={{ ...inputStyle, display: "flex", alignItems: "center", color: "var(--trackify-text-secondary)", background: "var(--surface)" }}>
            Assigned automatically on save
          </div>
          <span style={{ fontSize: 11, color: "var(--trackify-text-secondary)", display: "block", marginTop: 4 }}>
            The driver signs in with this and their PIN.
          </span>
        </div>
        {/* The PIN is never typed or seen here: the system makes it and emails it to the driver alone. */}
        <div>
          <span style={labelStyle}>PIN</span>
          <div aria-label="PIN" style={{ ...inputStyle, display: "flex", alignItems: "center", color: "var(--trackify-text-secondary)", background: "var(--surface)" }}>
            Generated automatically on save
          </div>
          <span style={{ fontSize: 11, color: "var(--trackify-text-secondary)", display: "block", marginTop: 4 }}>
            Emailed to {form.email.trim() || "the driver's email"} with their employee number. They can change it in the app.
          </span>
        </div>
      </div>

      <h4 className="tk-modal-form-section-title" style={{ marginTop: "var(--s-4)" }}>Emergency Contact</h4>
      <div className="tk-modal-form-grid">
        <div><label style={labelStyle}>Name</label><input style={inputStyle} value={form.emergencyContact.name} onChange={changeEmergency("name")} /></div>
        <div><label style={labelStyle}>Phone</label><input style={inputStyle} value={form.emergencyContact.phone} onChange={changeEmergency("phone")} /></div>
        <div><label style={labelStyle}>Relationship</label><input style={inputStyle} value={form.emergencyContact.relationship} onChange={changeEmergency("relationship")} /></div>
      </div>

      <div style={{ marginTop: 16, padding: 13, borderRadius: 10, border: `1px solid ${reviewed ? "var(--success)" : "var(--line-strong)"}`, background: reviewed ? "var(--success-soft)" : "var(--surface-2)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 700, marginBottom: 8 }}><ShieldCheck size={17} /> Admin verification</div>
        <label style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12, lineHeight: 1.45, cursor: readable && requiredComplete && !duplicate && !expiryProblem ? "pointer" : "not-allowed" }}>
          <input type="checkbox" checked={reviewed} disabled={!readable || !requiredComplete || Boolean(duplicate) || Boolean(expiryProblem)} onChange={(e) => setReviewed(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0 }} />
          <span>I compared the profile and licence fields with the uploaded image. Any OCR mistakes have been corrected, and the information is accurate and complete.</span>
        </label>
        {!scan && <p style={{ margin: "8px 0 0 27px", color: "var(--trackify-text-secondary)", fontSize: 11 }}>Upload the licence, then compare the extracted values with the image.</p>}
        {scan && !readable && <p role="alert" style={{ margin: "8px 0 0 27px", color: "var(--danger)", fontSize: 11 }}>Upload a clear licence that OCR can read before verifying.</p>}
        {readable && !requiredComplete && <p style={{ margin: "8px 0 0 27px", color: "var(--warn)", fontSize: 11 }}>Complete all required profile and licence fields before verifying.</p>}
      </div>

      {error && <div role="alert" style={{ marginTop: 12, color: "var(--danger)", fontSize: 12 }}>{error}</div>}
      <div className="tk-modal-form-actions">
        <Button variant="secondary" type="button" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!ready || saving}>{saving ? "Saving driver…" : "Save Driver"}</Button>
      </div>
    </form>
  );
}
