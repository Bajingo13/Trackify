import { useMemo, useState } from "react";
import { Check, Clipboard, Building2, MapPin, UserRound, KeyRound } from "lucide-react";
import { SettingsPage, FormSection } from "../../../components/settings";
import { Button } from "../../../components/ui";
import { createClientSetup } from "../../../services/admin/clientOnboardingService";

const STEPS = ["Company Details", "First Branch", "Client Administrator", "Initial Access", "Setup Summary"];
const EMPTY = {
  companyName: "", companyCode: "", branchName: "", branchCode: "", prefix: "",
  firstName: "", lastName: "", email: "",
};

function Field({ label, name, value, onChange, type = "text", hint, maxLength }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <input
        className="ops-form-input"
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        required
        maxLength={maxLength}
      />
      {hint && <small style={{ color: "var(--text-3)" }}>{hint}</small>}
    </label>
  );
}

export default function ClientSetupPage() {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const canContinue = useMemo(() => {
    if (step === 0) return values.companyName.trim() && values.companyCode.trim();
    if (step === 1) return values.branchName.trim() && values.branchCode.trim();
    if (step === 2) return values.firstName.trim() && values.lastName.trim() && /.+@.+\..+/.test(values.email);
    return true;
  }, [step, values]);

  function change(event) {
    const { name, value } = event.target;
    const codeField = ["companyCode", "branchCode", "prefix"].includes(name);
    setValues((current) => ({ ...current, [name]: codeField ? value.toUpperCase() : value }));
  }

  async function create() {
    setSaving(true);
    setError("");
    try {
      setResult(await createClientSetup(values));
    } catch (err) {
      setError(err.message || "Client setup failed.");
    } finally {
      setSaving(false);
    }
  }

  async function copyPassword() {
    await navigator.clipboard.writeText(result.temporaryPassword);
    setCopied(true);
  }

  function reset() {
    setValues(EMPTY);
    setStep(0);
    setResult(null);
    setError("");
    setCopied(false);
  }

  if (result) {
    const emailed = result.delivery === "email";
    return (
      <SettingsPage eyebrow="Organization" title="Client setup complete" description="The company, first branch, standard roles, and first administrator were created together.">
        <div style={{ maxWidth: 700, display: "grid", gap: 20 }}>
          <div style={{ padding: 20, borderRadius: 12, background: "#ecfdf5", border: "1px solid #a7f3d0" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 700, color: "#047857" }}><Check size={20} /> {result.company.companyName} is ready</div>
            <p style={{ marginBottom: 0, color: "#065f46" }}>
              {emailed
                ? <>A temporary password has been emailed to {result.administrator.email}. It expires {new Date(result.expiresAt).toLocaleString()}, and they must choose their own password at first sign-in.</>
                : <>{result.administrator.email} can sign in immediately using the temporary password below.</>}
            </p>
          </div>
          {!emailed && <FormSection title="One-time temporary password" description="Copy this now. Trackify does not store or show the plain password again.">
            {result.deliveryProblem && <p role="status" style={{ marginTop: 0, color: "#92400e" }}>{result.deliveryProblem} Give it to the administrator yourself.</p>}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <code style={{ padding: "12px 14px", borderRadius: 8, background: "var(--surface-2, #f1f5f9)", fontSize: 17 }}>{result.temporaryPassword}</code>
              <Button type="button" variant="secondary" icon={Clipboard} onClick={copyPassword}>{copied ? "Copied" : "Copy password"}</Button>
            </div>
            <p style={{ color: "var(--text-2)", marginBottom: 0 }}>Expires {new Date(result.expiresAt).toLocaleString()}. The administrator must create a different permanent password on first login.</p>
          </FormSection>}
          <div><Button type="button" variant="primary" onClick={reset}>Set up another client</Button></div>
        </div>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage eyebrow="Organization" title="New Client Setup" description="Create a complete client workspace without leaving half-finished company records behind.">
      <div style={{ maxWidth: 760 }}>
        <ol aria-label="Setup progress" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8, padding: 0, margin: "0 0 24px", listStyle: "none" }}>
          {STEPS.map((label, index) => (
            <li key={label} style={{ fontSize: 12, fontWeight: index === step ? 700 : 500, color: index <= step ? "var(--primary, #315efb)" : "var(--text-3)", borderTop: `3px solid ${index <= step ? "var(--primary, #315efb)" : "var(--border, #dbe2ea)"}`, paddingTop: 8 }}>{label}</li>
          ))}
        </ol>

        {step === 0 && <FormSection title="Company details" description="This becomes the client's separate workspace.">
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "2fr 1fr" }}>
            <Field label="Company name" name="companyName" value={values.companyName} onChange={change} />
            <Field label="Company code" name="companyCode" value={values.companyCode} onChange={change} maxLength={50} hint="Example: ABL" />
          </div>
        </FormSection>}

        {step === 1 && <FormSection title="First branch" description="Every company needs at least one place where its team can operate.">
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "2fr 1fr 1fr" }}>
            <Field label="Branch name" name="branchName" value={values.branchName} onChange={change} />
            <Field label="Branch code" name="branchCode" value={values.branchCode} onChange={change} maxLength={50} />
            <Field label="Document prefix" name="prefix" value={values.prefix} onChange={change} maxLength={10} hint="Optional" />
          </div>
        </FormSection>}

        {step === 2 && <FormSection title="Client administrator" description="This person receives company-wide administrator access automatically.">
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
            <Field label="First name" name="firstName" value={values.firstName} onChange={change} />
            <Field label="Last name" name="lastName" value={values.lastName} onChange={change} />
            <div style={{ gridColumn: "1 / -1" }}><Field label="Email address" name="email" type="email" value={values.email} onChange={change} /></div>
          </div>
        </FormSection>}

        {step === 3 && <FormSection title="Initial access" description="How the administrator gets in the first time.">
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}><KeyRound size={24} /><div><strong>Trackify will generate a one-time temporary password.</strong><p style={{ color: "var(--text-2)", lineHeight: 1.55 }}>It is emailed straight to the administrator. If this server cannot send email, it is shown to you once after setup instead. It expires after 72 hours, and at first login the administrator cannot enter the system until they replace it with their own password.</p></div></div>
        </FormSection>}

        {step === 4 && <FormSection title="Review setup" description="Nothing is created until you confirm this summary.">
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "flex", gap: 12 }}><Building2 /><div><strong>{values.companyName}</strong><div style={{ color: "var(--text-2)" }}>Company code: {values.companyCode}</div></div></div>
            <div style={{ display: "flex", gap: 12 }}><MapPin /><div><strong>{values.branchName}</strong><div style={{ color: "var(--text-2)" }}>Branch code: {values.branchCode}; prefix: {values.prefix || values.branchCode}</div></div></div>
            <div style={{ display: "flex", gap: 12 }}><UserRound /><div><strong>{values.firstName} {values.lastName}</strong><div style={{ color: "var(--text-2)" }}>{values.email} - Company Administrator</div></div></div>
          </div>
        </FormSection>}

        {error && <div role="alert" style={{ marginTop: 16, color: "#b91c1c" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 20 }}>
          <Button type="button" variant="ghost" disabled={step === 0 || saving} onClick={() => setStep((value) => value - 1)}>Back</Button>
          {step < STEPS.length - 1
            ? <Button type="button" variant="primary" disabled={!canContinue} onClick={() => setStep((value) => value + 1)}>Continue</Button>
            : <Button type="button" variant="primary" loading={saving} onClick={create}>Create client</Button>}
        </div>
      </div>
    </SettingsPage>
  );
}
