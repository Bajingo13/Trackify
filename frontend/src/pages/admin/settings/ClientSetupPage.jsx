import { useMemo, useState } from "react";
import { Check, Clipboard, Send } from "lucide-react";
import { SettingsPage, FormSection } from "../../../components/settings";
import { Button, Select } from "../../../components/ui";
import { createClientSetup } from "../../../services/admin/clientOnboardingService";

/*
 * New Client Setup: one guided pass that creates a complete client — the
 * company and its profile, its first branch, and an invited administrator.
 * Grouped into short steps so it never feels like one long form. Only the
 * company name/code, branch name/code and administrator are required; the
 * rest is optional but checked as it is typed (the server checks again —
 * backend/src/modules/admin/clientProfile.js).
 */

const STEPS = ["Company profile", "Contact & address", "First branch", "Client administrator", "Billing & review"];

const BUSINESS_TYPES = ["Corporation", "Partnership", "Sole proprietorship", "Cooperative", "Government", "Other"];
const INDUSTRIES = [
  "Logistics & trucking", "Manufacturing", "Retail & distribution", "Food & beverage",
  "Construction", "Agriculture", "E-commerce", "Other",
];
const PAYMENT_TERMS = ["Cash on delivery", "Net 15", "Net 30", "Net 45", "Net 60"];

const EMPTY = {
  // company profile
  companyName: "", tradeName: "", companyCode: "", businessType: "", industry: "", tin: "", fleetSize: "",
  // contact
  companyEmail: "", companyPhone: "", website: "", contactName: "", contactPosition: "", contactPhone: "",
  // registered address
  addressLine: "", barangay: "", city: "", province: "", postalCode: "", country: "Philippines",
  // first branch
  branchName: "", branchCode: "", prefix: "", branchSameAddress: true,
  branchAddressLine: "", branchCity: "", branchProvince: "", branchPostalCode: "", branchPhone: "",
  // administrator
  firstName: "", lastName: "", email: "",
  // billing
  billingEmail: "", paymentTerms: "", contractStart: "", notes: "",
};

const CODE_FIELDS = ["companyCode", "branchCode", "prefix"];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9(][0-9 ()-]{5,18}[0-9]$/;
const TIN = /^\d{3}-?\d{3}-?\d{3}(-?\d{3,5})?$/;
const POSTAL = /^\d{4,10}$/;
const CODE = /^[A-Z0-9][A-Z0-9_-]*$/;

const blank = (v) => !String(v ?? "").trim();

/* Per-field problems, in words. Required-and-empty is reported separately so
   an untouched form is not a wall of red. */
function fieldErrors(v) {
  const e = {};
  const optional = (key, ok, message) => { if (!blank(v[key]) && !ok(String(v[key]).trim())) e[key] = message; };

  if (!blank(v.companyCode) && !CODE.test(v.companyCode)) e.companyCode = "Letters, numbers, hyphens and underscores only.";
  optional("tin", (s) => TIN.test(s), "Use 000-000-000 or 000-000-000-000.");
  optional("fleetSize", (s) => /^\d+$/.test(s) && Number(s) <= 100000, "A whole number of vehicles.");
  optional("companyEmail", (s) => EMAIL.test(s), "Enter a valid email address.");
  optional("companyPhone", (s) => PHONE.test(s), "e.g. +63 2 8123 4567");
  optional("website", (s) => /^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(s), "e.g. www.company.com");
  optional("contactPhone", (s) => PHONE.test(s), "e.g. +63 917 123 4567");
  optional("postalCode", (s) => POSTAL.test(s), "Numbers only, e.g. 1226.");
  if (!blank(v.branchCode) && !CODE.test(v.branchCode)) e.branchCode = "Letters, numbers, hyphens and underscores only.";
  optional("branchPostalCode", (s) => POSTAL.test(s), "Numbers only, e.g. 8000.");
  optional("branchPhone", (s) => PHONE.test(s), "e.g. (082) 123-4567");
  optional("email", (s) => EMAIL.test(s), "Enter a valid email address.");
  optional("billingEmail", (s) => EMAIL.test(s), "Enter a valid email address.");
  return e;
}

const STEP_FIELDS = [
  { required: ["companyName", "companyCode"], all: ["companyName", "tradeName", "companyCode", "businessType", "industry", "tin", "fleetSize"] },
  { required: [], all: ["companyEmail", "companyPhone", "website", "contactName", "contactPosition", "contactPhone", "addressLine", "barangay", "city", "province", "postalCode", "country"] },
  { required: ["branchName", "branchCode"], all: ["branchName", "branchCode", "prefix", "branchAddressLine", "branchCity", "branchProvince", "branchPostalCode", "branchPhone"] },
  { required: ["firstName", "lastName", "email"], all: ["firstName", "lastName", "email"] },
  { required: [], all: ["billingEmail", "paymentTerms", "contractStart", "notes"] },
];

const grid = { display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" };
const full = { gridColumn: "1 / -1" };

function Field({ label, name, values, onChange, errors, required, type = "text", hint, maxLength, options, textarea, span, placeholder }) {
  const id = `cs-${name}`;
  const error = errors[name];
  const common = {
    id,
    name,
    value: values[name],
    onChange,
    className: "ops-form-input",
    required,
    maxLength,
    placeholder,
    "aria-invalid": error ? "true" : undefined,
    "aria-describedby": error || hint ? `${id}-note` : undefined,
    style: error ? { borderColor: "var(--danger, #d64545)" } : undefined,
  };
  return (
    <div style={{ display: "grid", gap: 6, alignContent: "start", ...(span ? full : null) }}>
      <label htmlFor={id} style={{ fontWeight: 600, fontSize: "var(--fs-13, 13px)" }}>
        {label}
        {!required && <span style={{ marginLeft: 6, fontWeight: 400, fontSize: 11, color: "var(--text-3)" }}>Optional</span>}
      </label>
      {options ? (
        <Select
          id={id}
          value={values[name] ?? ""}
          onChange={(v) => onChange({ target: { name, value: v, type: "select" } })}
          required={required}
          error={!!error}
          options={[{ value: "", label: "Select…" }, ...options.map((o) => ({ value: o, label: o }))]}
        />
      ) : textarea ? (
        <textarea {...common} rows={3} style={{ ...common.style, resize: "vertical", minHeight: 76 }} />
      ) : (
        <input {...common} type={type} />
      )}
      {(error || hint) && (
        <small id={`${id}-note`} style={{ color: error ? "var(--danger, #b91c1c)" : "var(--text-3)" }}>{error || hint}</small>
      )}
    </div>
  );
}

function SubHeading({ children }) {
  return (
    <div style={{ ...full, marginTop: 4, paddingTop: 12, borderTop: "1px solid var(--line)", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)" }}>
      {children}
    </div>
  );
}

/* One block of the review: only the lines that were filled in. */
function Summary({ title, rows }) {
  const filled = rows.filter(([, value]) => !blank(value));
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-md, 10px)", overflow: "hidden" }}>
      <div style={{ padding: "9px 14px", background: "var(--surface-2)", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-2)" }}>{title}</div>
      <dl style={{ margin: 0, padding: "4px 14px 10px", display: "grid", gridTemplateColumns: "minmax(120px, 34%) 1fr", gap: "6px 12px", fontSize: 13 }}>
        {filled.length ? filled.map(([label, value]) => (
          <div key={label} style={{ display: "contents" }}>
            <dt style={{ color: "var(--text-3)" }}>{label}</dt>
            <dd style={{ margin: 0, color: "var(--text)", overflowWrap: "anywhere" }}>{value}</dd>
          </div>
        )) : <dd style={{ ...full, margin: 0, color: "var(--text-3)" }}>Nothing added.</dd>}
      </dl>
    </div>
  );
}

const joinAddress = (...parts) => parts.filter((p) => !blank(p)).join(", ");

export default function ClientSetupPage() {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const errors = useMemo(() => fieldErrors(values), [values]);
  const canContinue = useMemo(() => {
    const { required, all } = STEP_FIELDS[step];
    return required.every((k) => !blank(values[k])) && all.every((k) => !errors[k]);
  }, [step, values, errors]);

  function change(event) {
    const { name, value, type, checked } = event.target;
    const next = type === "checkbox" ? checked : CODE_FIELDS.includes(name) ? value.toUpperCase() : value;
    setValues((current) => ({ ...current, [name]: next }));
  }

  // The branch address, whether typed or copied from the company.
  const branchAddress = values.branchSameAddress
    ? { branchAddressLine: joinAddress(values.addressLine, values.barangay), branchCity: values.city, branchProvince: values.province, branchPostalCode: values.postalCode }
    : { branchAddressLine: values.branchAddressLine, branchCity: values.branchCity, branchProvince: values.branchProvince, branchPostalCode: values.branchPostalCode };

  async function create() {
    setSaving(true);
    setError("");
    try {
      const { branchSameAddress, ...rest } = values;
      setResult(await createClientSetup({ ...rest, ...branchAddress }));
    } catch (err) {
      setError(err.message || "Client setup failed.");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(result.inviteUrl);
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
      <SettingsPage eyebrow="Organization" title="Client setup complete" description="The company, its profile, first branch, standard roles, and first administrator were created together.">
        <div style={{ maxWidth: 700, display: "grid", gap: 20 }}>
          <div style={{ padding: 20, borderRadius: 12, background: "#ecfdf5", border: "1px solid #a7f3d0" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 700, color: "#047857" }}><Check size={20} /> {result.company.companyName} is ready</div>
            <p style={{ marginBottom: 0, color: "#065f46" }}>
              {emailed
                ? <>An invitation has been emailed to {result.administrator.email}. They’ll finish their account and choose their own password from the link, which expires {new Date(result.expiresAt).toLocaleString()}.</>
                : <>Share the invitation link below with {result.administrator.email} so they can finish their account and choose their own password.</>}
            </p>
          </div>
          {!emailed && <FormSection title="One-time invitation link" description="Copy this now. It works once, and Trackify does not show it again — resend from Users if it is lost.">
            {result.deliveryProblem && <p role="status" style={{ marginTop: 0, color: "#92400e" }}>{result.deliveryProblem} Give the link to the administrator yourself.</p>}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <code style={{ padding: "12px 14px", borderRadius: 8, background: "var(--surface-2, #f1f5f9)", fontSize: 12.5, overflowWrap: "anywhere", flex: "1 1 320px" }}>{result.inviteUrl}</code>
              <Button type="button" variant="secondary" icon={Clipboard} onClick={copyLink}>{copied ? "Copied" : "Copy link"}</Button>
            </div>
            <p style={{ color: "var(--text-2)", marginBottom: 0 }}>Expires {new Date(result.expiresAt).toLocaleString()}.</p>
          </FormSection>}
          <div><Button type="button" variant="primary" onClick={reset}>Set up another client</Button></div>
        </div>
      </SettingsPage>
    );
  }

  const f = { values, onChange: change, errors };

  return (
    <SettingsPage eyebrow="Organization" title="New Client Setup" description="Create a complete client workspace without leaving half-finished company records behind.">
      <div style={{ maxWidth: 820 }}>
        <ol aria-label="Setup progress" style={{ display: "grid", gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))`, gap: 8, padding: 0, margin: "0 0 24px", listStyle: "none" }}>
          {STEPS.map((label, index) => (
            <li key={label} aria-current={index === step ? "step" : undefined} style={{ fontSize: 12, fontWeight: index === step ? 700 : 500, color: index <= step ? "var(--primary, #315efb)" : "var(--text-3)", borderTop: `3px solid ${index <= step ? "var(--primary, #315efb)" : "var(--border, #dbe2ea)"}`, paddingTop: 8 }}>{label}</li>
          ))}
        </ol>

        {step === 0 && (
          <FormSection title="Company profile" description="Who the client is. This becomes their separate workspace in Trackify.">
            <div style={grid}>
              <Field {...f} span required label="Registered company name" name="companyName" maxLength={200} />
              <Field {...f} label="Trade name" name="tradeName" maxLength={200} hint="If they operate under a different name." />
              <Field {...f} required label="Company code" name="companyCode" maxLength={50} hint="Short and unique, e.g. ABL" />
              <Field {...f} label="Business type" name="businessType" options={BUSINESS_TYPES} />
              <Field {...f} label="Industry" name="industry" options={INDUSTRIES} />
              <Field {...f} label="TIN" name="tin" maxLength={20} placeholder="000-000-000-000" />
              <Field {...f} label="Fleet size" name="fleetSize" type="number" hint="Number of vehicles, roughly." />
            </div>
          </FormSection>
        )}

        {step === 1 && (
          <>
            <FormSection title="Contact information" description="How to reach the client, and who to talk to.">
              <div style={grid}>
                <Field {...f} label="Company email" name="companyEmail" type="email" maxLength={200} />
                <Field {...f} label="Company phone" name="companyPhone" type="tel" maxLength={40} />
                <Field {...f} span label="Website" name="website" maxLength={200} placeholder="www.company.com" />
                <SubHeading>Primary contact person</SubHeading>
                <Field {...f} label="Full name" name="contactName" maxLength={150} />
                <Field {...f} label="Position" name="contactPosition" maxLength={100} placeholder="e.g. Operations Manager" />
                <Field {...f} label="Contact number" name="contactPhone" type="tel" maxLength={40} />
              </div>
            </FormSection>
            <FormSection title="Registered address" description="The company's official business address.">
              <div style={grid}>
                <Field {...f} span label="Street address" name="addressLine" maxLength={255} placeholder="Unit, building, street" />
                <Field {...f} label="Barangay" name="barangay" maxLength={120} />
                <Field {...f} label="City / Municipality" name="city" maxLength={120} />
                <Field {...f} label="Province" name="province" maxLength={120} />
                <Field {...f} label="Postal code" name="postalCode" maxLength={10} />
                <Field {...f} label="Country" name="country" maxLength={80} />
              </div>
            </FormSection>
          </>
        )}

        {step === 2 && (
          <FormSection title="First branch" description="Every company needs at least one place where its team can operate.">
            <div style={grid}>
              <Field {...f} required label="Branch name" name="branchName" maxLength={200} />
              <Field {...f} required label="Branch code" name="branchCode" maxLength={50} />
              <Field {...f} label="Document prefix" name="prefix" maxLength={10} hint="Starts trip ticket numbers. Defaults to the branch code." />
              <Field {...f} label="Branch phone" name="branchPhone" type="tel" maxLength={40} />
              <SubHeading>Branch address</SubHeading>
              <label style={{ ...full, display: "flex", gap: 8, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" name="branchSameAddress" checked={values.branchSameAddress} onChange={change} />
                Same as the company’s registered address
              </label>
              {!values.branchSameAddress && (
                <>
                  <Field {...f} span label="Street address" name="branchAddressLine" maxLength={255} />
                  <Field {...f} label="City / Municipality" name="branchCity" maxLength={120} />
                  <Field {...f} label="Province" name="branchProvince" maxLength={120} />
                  <Field {...f} label="Postal code" name="branchPostalCode" maxLength={10} />
                </>
              )}
            </div>
          </FormSection>
        )}

        {step === 3 && (
          <FormSection title="Client administrator" description="This person receives company-wide administrator access and manages the client's own users.">
            <div style={grid}>
              <Field {...f} required label="First name" name="firstName" maxLength={100} />
              <Field {...f} required label="Last name" name="lastName" maxLength={100} />
              <Field {...f} span required label="Email address" name="email" type="email" maxLength={200} hint="Their sign-in address. The invitation goes here." />
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 14px", borderRadius: "var(--r-md, 10px)", background: "var(--info-soft, #e9f0fe)", fontSize: 13, lineHeight: 1.55, color: "var(--text-2)" }}>
              <Send size={16} style={{ flexShrink: 0, marginTop: 2, color: "var(--info, #2455d6)" }} aria-hidden="true" />
              <span>Trackify emails them an invitation to finish their account and choose their own password — nobody else ever sees it. If email can’t be sent, you’ll get a one-time link to pass on. It expires after 72 hours.</span>
            </div>
          </FormSection>
        )}

        {step === 4 && (
          <>
            <FormSection title="Billing & contract" description="Commercial basics for managing the account.">
              <div style={grid}>
                <Field {...f} label="Billing email" name="billingEmail" type="email" maxLength={200} hint="Where invoices go, if not the company email." />
                <Field {...f} label="Payment terms" name="paymentTerms" options={PAYMENT_TERMS} />
                <Field {...f} label="Contract start" name="contractStart" type="date" />
                <Field {...f} span textarea label="Notes" name="notes" maxLength={1000} placeholder="Anything the team should know about this client." />
              </div>
            </FormSection>
            <FormSection title="Review setup" description="Nothing is created until you confirm.">
              <div style={{ display: "grid", gap: 12 }}>
                <Summary title="Company" rows={[
                  ["Registered name", values.companyName], ["Trade name", values.tradeName], ["Code", values.companyCode],
                  ["Business type", values.businessType], ["Industry", values.industry], ["TIN", values.tin], ["Fleet size", values.fleetSize],
                ]} />
                <Summary title="Contact & address" rows={[
                  ["Email", values.companyEmail], ["Phone", values.companyPhone], ["Website", values.website],
                  ["Primary contact", joinAddress(values.contactName, values.contactPosition, values.contactPhone)],
                  ["Address", joinAddress(values.addressLine, values.barangay, values.city, values.province, values.postalCode, values.country)],
                ]} />
                <Summary title="First branch" rows={[
                  ["Branch", `${values.branchName} (${values.branchCode})`], ["Document prefix", values.prefix || values.branchCode],
                  ["Phone", values.branchPhone],
                  ["Address", joinAddress(branchAddress.branchAddressLine, branchAddress.branchCity, branchAddress.branchProvince, branchAddress.branchPostalCode)],
                ]} />
                <Summary title="Administrator (invited)" rows={[
                  ["Name", `${values.firstName} ${values.lastName}`], ["Email", values.email], ["Role", "Company Administrator"],
                ]} />
                <Summary title="Billing" rows={[
                  ["Billing email", values.billingEmail], ["Payment terms", values.paymentTerms],
                  ["Contract start", values.contractStart], ["Notes", values.notes],
                ]} />
              </div>
            </FormSection>
          </>
        )}

        {error && <div role="alert" style={{ marginTop: 16, color: "#b91c1c" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 20 }}>
          <Button type="button" variant="ghost" disabled={step === 0 || saving} onClick={() => setStep((value) => value - 1)}>Back</Button>
          {step < STEPS.length - 1
            ? <Button type="button" variant="primary" disabled={!canContinue} onClick={() => setStep((value) => value + 1)}>Continue</Button>
            : <Button type="button" variant="primary" loading={saving} disabled={!canContinue} onClick={create}>Create client</Button>}
        </div>
      </div>
    </SettingsPage>
  );
}
