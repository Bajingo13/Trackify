import { useRef, useState } from "react";
import { CheckCircle2, KeyRound, ShieldCheck } from "lucide-react";
import { Button, Select } from "../ui";
import LicenseScanner from "./LicenseScanner";
import { applyLicenseScan } from "./applyLicenseScan";
import { checkDriverEmployeeNo, DEFAULT_LICENSE_TYPE, LICENSE_TYPES } from "../../services/fleet/driverService";
import { licenceExpiry } from "../../services/fleet/licenceExpiry";

const inputStyle = { height: 40, padding: "8px 11px", border: "1px solid var(--line-strong)", borderRadius: 8, fontSize: 13, width: "100%", background: "var(--surface-2)", color: "var(--text)" };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 4, display: "block" };
const readColour = { high: "var(--info)", low: "var(--warn)" };

export function generateDriverPin(random = globalThis.crypto) {
  const value = new Uint32Array(1);
  random.getRandomValues(value);
  return String(1000 + (value[0] % 9000));
}

const initialForm = () => ({
  employeeNo: "", pin: "", firstName: "", lastName: "", contactNo: "",
  licenseNo: "", licenseType: DEFAULT_LICENSE_TYPE, licenseExpiry: "",
  emergencyContact: { name: "", phone: "", relationship: "" },
});

function StepHeader({ step }) {
  return (
    <div aria-label={`Registration step ${step} of 2`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}>
      {["Account access", "Profile & licence"].map((label, i) => {
        const number = i + 1;
        const active = step === number;
        const complete = step > number;
        return (
          <div key={label} style={{ borderRadius: 9, padding: "9px 11px", border: `1px solid ${active || complete ? "var(--info-line)" : "var(--line)"}`, background: active || complete ? "var(--info-soft)" : "var(--surface-2)", color: active || complete ? "var(--info)" : "var(--trackify-text-secondary)", fontSize: 12, fontWeight: 700 }}>
            {complete ? "✓" : number}. {label}
          </div>
        );
      })}
    </div>
  );
}

export default function DriverRegistrationForm({ onSave, onCancel }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initialForm);
  const [showPin, setShowPin] = useState(false);
  const [checking, setChecking] = useState(false);
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

  async function continueToProfile(e) {
    e.preventDefault();
    const employeeNo = form.employeeNo.trim();
    if (!employeeNo) { setError("Employee Number is required."); return; }
    if (!/^\d{4,6}$/.test(form.pin)) { setError("PIN must be 4 to 6 digits."); return; }
    setChecking(true);
    setError("");
    try {
      if (!(await checkDriverEmployeeNo(employeeNo))) {
        setError(`Employee number ${employeeNo} already belongs to another driver.`);
        return;
      }
      setForm((old) => ({ ...old, employeeNo }));
      setStep(2);
    } catch (ex) {
      setError(ex.message || "Could not check the Employee Number. Try again.");
    } finally {
      setChecking(false);
    }
  }

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
      && form.licenseNo.trim() && form.licenseExpiry
  );
  const duplicate = scan?.duplicateOf && String(scan.fields?.licenseNo || "").toLowerCase() === form.licenseNo.trim().toLowerCase()
    ? scan.duplicateOf : null;
  const ready = readable && requiredComplete && !duplicate && reviewed;

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

  if (step === 1) {
    return (
      <form onSubmit={continueToProfile} noValidate>
        <StepHeader step={step} />
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: 10, background: "var(--info-soft)", border: "1px solid var(--info-line)", marginBottom: 16, color: "var(--info)", fontSize: 12, lineHeight: 1.5 }}>
          <KeyRound size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Start with the two credentials the driver will use to sign in. The account is saved only after the profile and licence review are complete.</span>
        </div>
        <div className="tk-modal-form-grid">
          <div>
            <label style={labelStyle} htmlFor="new-driver-employee-no">Employee Number *</label>
            <input id="new-driver-employee-no" style={inputStyle} value={form.employeeNo} onChange={change("employeeNo")} autoComplete="off" required />
          </div>
          <div>
            <label style={labelStyle} htmlFor="new-driver-pin">PIN *</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input id="new-driver-pin" style={{ ...inputStyle, letterSpacing: "0.18em" }} type={showPin ? "text" : "password"} inputMode="numeric" autoComplete="new-password" maxLength={6} value={form.pin} onChange={(e) => { setForm((old) => ({ ...old, pin: e.target.value.replace(/\D/g, "") })); setError(""); }} required />
              <button type="button" className="ops-btn ops-btn-secondary" style={{ minHeight: 40, whiteSpace: "nowrap" }} onClick={() => { setForm((old) => ({ ...old, pin: generateDriverPin() })); setShowPin(true); setError(""); }}>Generate</button>
            </div>
            <button type="button" onClick={() => setShowPin((v) => !v)} style={{ border: 0, background: "none", color: "var(--info)", padding: "5px 0", minHeight: 40, fontSize: 11, cursor: "pointer" }}>{showPin ? "Hide PIN" : "Show PIN"}</button>
          </div>
        </div>
        {error && <div role="alert" style={{ marginTop: 12, color: "var(--danger)", fontSize: 12 }}>{error}</div>}
        <div className="tk-modal-form-actions">
          <Button variant="secondary" type="button" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={checking}>{checking ? "Checking…" : "Continue"}</Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <StepHeader step={step} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 9, background: "var(--surface-2)", border: "1px solid var(--line)", marginBottom: 14, fontSize: 12 }}>
        <CheckCircle2 size={16} color="var(--success)" />
        <span><strong>{form.employeeNo}</strong> · PIN set</span>
        <button type="button" onClick={() => { setStep(1); setReviewed(false); }} style={{ marginLeft: "auto", border: 0, background: "none", color: "var(--info)", fontWeight: 700, cursor: "pointer", minHeight: 40 }}>Change</button>
      </div>

      <LicenseScanner onScanned={scanned} onCleared={clearScan} title="Driver's licence photo or scan (required)" />
      {nameNote && <div role="alert" style={{ marginBottom: 14, padding: "8px 10px", borderRadius: 8, fontSize: 12, lineHeight: 1.45, background: "var(--warn-soft)", border: "1px solid var(--warn-line)", color: "var(--warn)" }}>{nameNote}</div>}

      <div className="tk-modal-form-grid">
        <div><label style={labelStyle} htmlFor="new-driver-first-name">First Name *</label><input id="new-driver-first-name" style={readStyle("firstName")} value={form.firstName} onChange={change("firstName", { reviewSensitive: true })} required />{hint("firstName")}</div>
        <div><label style={labelStyle} htmlFor="new-driver-last-name">Last Name *</label><input id="new-driver-last-name" style={readStyle("lastName")} value={form.lastName} onChange={change("lastName", { reviewSensitive: true })} required />{hint("lastName")}</div>
        <div><label style={labelStyle} htmlFor="new-driver-contact">Contact Number *</label><input id="new-driver-contact" style={inputStyle} value={form.contactNo} onChange={change("contactNo")} required placeholder="+63 917 123 4567" /></div>
        <div>
          <label style={labelStyle} htmlFor="new-driver-license-no">License Number *</label>
          <input id="new-driver-license-no" style={readStyle("licenseNo")} value={form.licenseNo} onChange={change("licenseNo", { reviewSensitive: true })} required />
          {hint("licenseNo")}
          {duplicate && <span role="alert" style={{ fontSize: 11, display: "block", marginTop: 4, color: "var(--danger)", fontWeight: 600 }}>Already belongs to {duplicate.name}</span>}
        </div>
        <div><label style={labelStyle}>License Type</label><Select value={form.licenseType} onChange={(value) => change("licenseType", { reviewSensitive: true })({ target: { value } })} options={LICENSE_TYPES.map((value) => ({ value, label: value }))} />{hint("licenseType")}</div>
        <div>
          <label style={labelStyle} htmlFor="new-driver-license-expiry">License Expiry *</label>
          <input id="new-driver-license-expiry" style={readStyle("licenseExpiry")} type="date" value={form.licenseExpiry} onChange={change("licenseExpiry", { reviewSensitive: true })} required />
          {hint("licenseExpiry")}
          {form.licenseExpiry && licenceExpiry(form.licenseExpiry).state !== "valid" && <span style={{ fontSize: 11, display: "block", marginTop: 4, fontWeight: 600, color: licenceExpiry(form.licenseExpiry).state === "expired" ? "var(--danger)" : "var(--warn)" }}>{licenceExpiry(form.licenseExpiry).text}</span>}
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
        <label style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12, lineHeight: 1.45, cursor: readable && requiredComplete && !duplicate ? "pointer" : "not-allowed" }}>
          <input type="checkbox" checked={reviewed} disabled={!readable || !requiredComplete || Boolean(duplicate)} onChange={(e) => setReviewed(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0 }} />
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
