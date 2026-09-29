import { useId, useState } from "react";
import { motion } from "motion/react";
import { User, Mail, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import PasswordRequirements from "../auth/PasswordRequirements";
import { meetsPasswordRules } from "../../auth/passwordRules";

const NAME_MAX = 100; // users.first_name / last_name are VARCHAR(100)

/* Same bare-button treatment as the card's other text links. */
const linkButton = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer",
};

function nameError(value, label) {
  const name = value.trim();
  if (!name) return `Enter your ${label}.`;
  if (name.length > NAME_MAX) return `Keep your ${label} to ${NAME_MAX} characters.`;
  return "";
}

function FieldMessage({ id, tone, children }) {
  if (!children) return null;
  const Icon = tone === "ok" ? CheckCircle2 : AlertCircle;
  return (
    <p id={id} className={`lp-field-msg is-${tone === "ok" ? "ok" : "error"}`}>
      <Icon size={13} aria-hidden="true" /> {children}
    </p>
  );
}

function NameField({ id, label, value, onChange, error, onBlur, autoComplete }) {
  const msgId = `${id}-msg`;
  return (
    <div className="lp-field">
      <div className="lp-label-row"><label htmlFor={id}>{label}</label></div>
      <div className={`lp-input is-plain${error ? " is-invalid" : ""}`}>
        <User size={17} />
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          required
          maxLength={NAME_MAX}
          autoComplete={autoComplete}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? msgId : undefined}
        />
      </div>
      <FieldMessage id={msgId}>{error}</FieldMessage>
    </div>
  );
}

function PasswordInput({ id, value, onChange, onBlur, visible, onToggle, toggleName, state, describedBy, autoFocus }) {
  return (
    <div className={`lp-input${state ? ` is-${state}` : ""}`}>
      <Lock size={17} />
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        required
        autoComplete="new-password"
        autoFocus={autoFocus}
        aria-invalid={state === "invalid" ? "true" : undefined}
        aria-describedby={describedBy}
      />
      <button
        type="button"
        className="lp-eye"
        onClick={onToggle}
        aria-label={visible ? `Hide ${toggleName}` : `Show ${toggleName}`}
        aria-pressed={visible}
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

/**
 * First-time account setup, inside the sign-in card: confirm your name, see
 * the address you sign in with (locked — an administrator owns it), and swap
 * the temporary password for a permanent one. Shown straight after signing in
 * with a temporary password, and whenever such an account lands on /login;
 * the app stays closed until this succeeds.
 *
 * The button stays disabled until every field is valid, and the note under it
 * says what is still missing, so nobody is left guessing why it will not press.
 */
const DEFAULT_INTRO =
  "You’re almost in. Check that your name is correct, then create a private password — it replaces " +
  "your temporary one and is what you’ll use to sign in to Trackify from now on.";

export default function ActivatePasswordForm({
  user,
  onActivate,
  onSwitchAccount,
  eyebrow = "First-time account setup",
  title = "Finish your account",
  intro = DEFAULT_INTRO,
  switchLabel = "Use a different account",
}) {
  const uid = useId();
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [touched, setTouched] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const touch = (field) => () => setTouched((t) => ({ ...t, [field]: true }));

  const firstError = nameError(firstName, "first name");
  const lastError = nameError(lastName, "last name");
  const passwordOk = meetsPasswordRules(password);
  const matches = confirmation.length > 0 && confirmation === password;
  // A mismatch is only called out once they have finished typing it, not on the first keystroke.
  const showMismatch =
    confirmation.length > 0 && !matches && (touched.confirm || confirmation.length >= password.length);

  const missing = [
    firstError && "your first name",
    lastError && "your last name",
    !passwordOk && "a password that meets every requirement",
    passwordOk && !matches && "the same password repeated",
  ].filter(Boolean);
  const canSubmit = missing.length === 0 && !saving;

  async function submit(e) {
    e.preventDefault();
    setTouched({ first: true, last: true, password: true, confirm: true });
    if (!canSubmit) return;
    setError("");
    setSaving(true);
    const result = await onActivate(password, { firstName: firstName.trim(), lastName: lastName.trim() });
    // On success the page moves on, so there is nothing to reset.
    if (!result?.success) {
      setError(result?.error || "Could not activate the account.");
      setSaving(false);
    }
  }

  const ids = {
    first: `${uid}-first`, last: `${uid}-last`, email: `${uid}-email`,
    password: `${uid}-pass`, reqs: `${uid}-reqs`, confirm: `${uid}-confirm`, note: `${uid}-note`,
  };

  return (
    <>
      <span className="eyb">{eyebrow}</span>
      <h2>{title}</h2>
      <p className="sub">{intro}</p>

      <form onSubmit={submit} noValidate>
        {error && (
          <div className="lp-error" role="alert">
            <AlertCircle size={15} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="lp-name-grid">
          <NameField
            id={ids.first}
            label="First name"
            value={firstName}
            onChange={setFirstName}
            onBlur={touch("first")}
            error={touched.first ? firstError : ""}
            autoComplete="given-name"
          />
          <NameField
            id={ids.last}
            label="Last name"
            value={lastName}
            onChange={setLastName}
            onBlur={touch("last")}
            error={touched.last ? lastError : ""}
            autoComplete="family-name"
          />
        </div>

        <div className="lp-field">
          <div className="lp-label-row">
            <label htmlFor={ids.email}>Email address</label>
            <span className="lp-hint">Your sign-in address</span>
          </div>
          <div className="lp-input is-readonly">
            <Mail size={17} />
            <input
              id={ids.email}
              type="email"
              value={user?.email || ""}
              readOnly
              aria-readonly="true"
              autoComplete="username"
            />
          </div>
        </div>

        <div className="lp-field">
          <div className="lp-label-row"><label htmlFor={ids.password}>Create password</label></div>
          <PasswordInput
            id={ids.password}
            value={password}
            onChange={setPassword}
            onBlur={touch("password")}
            visible={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
            toggleName="password"
            state={passwordOk ? "valid" : touched.password && password ? "invalid" : ""}
            describedBy={ids.reqs}
            autoFocus
          />
          <PasswordRequirements id={ids.reqs} password={password} />
        </div>

        <div className="lp-field">
          <div className="lp-label-row"><label htmlFor={ids.confirm}>Repeat password</label></div>
          <PasswordInput
            id={ids.confirm}
            value={confirmation}
            onChange={setConfirmation}
            onBlur={touch("confirm")}
            visible={showConfirmation}
            onToggle={() => setShowConfirmation((v) => !v)}
            toggleName="repeated password"
            state={matches ? "valid" : showMismatch ? "invalid" : ""}
            describedBy={matches || showMismatch ? `${ids.confirm}-msg` : undefined}
          />
          {matches && <FieldMessage id={`${ids.confirm}-msg`} tone="ok">Passwords match</FieldMessage>}
          {showMismatch && <FieldMessage id={`${ids.confirm}-msg`}>Passwords don’t match.</FieldMessage>}
        </div>

        <motion.button
          type="submit"
          className="lp-submit"
          disabled={!canSubmit}
          aria-describedby={missing.length ? ids.note : undefined}
          whileTap={canSubmit ? { scale: 0.985 } : undefined}
          style={{ marginTop: 6 }}
        >
          {saving ? (
            <>
              <span className="lp-spinner" />
              <span>Activating…</span>
            </>
          ) : (
            <>
              <span>Activate account</span>
              <ArrowRight size={17} />
            </>
          )}
        </motion.button>
        {missing.length > 0 && (
          <p id={ids.note} className="lp-submit-note">To continue, add {missing[0]}.</p>
        )}
      </form>

      <div style={{ marginTop: 18 }}>
        <button type="button" className="lp-link" style={linkButton} onClick={onSwitchAccount}>
          <ArrowLeft size={14} /> {switchLabel}
        </button>
      </div>
    </>
  );
}
