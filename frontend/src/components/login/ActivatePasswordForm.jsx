import { useState } from "react";
import { motion } from "motion/react";
import { Lock, Eye, EyeOff, Check, ArrowRight, ArrowLeft } from "lucide-react";

const MIN_LENGTH = 10;

/* Same bare-button treatment as the card's other text links. */
const linkButton = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer",
};

function Requirement({ met, children }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        color: met ? "#16a34a" : "#6b7690", transition: "color 0.15s",
      }}
    >
      <Check size={13} strokeWidth={met ? 3 : 2} /> {children}
    </span>
  );
}

function PasswordField({ id, label, hint, toggleName, value, onChange, visible, onToggle, autoFocus }) {
  return (
    <div className="lp-field">
      <div className="lp-label-row">
        <label htmlFor={id}>{label}</label>
        {hint && <span className="lp-hint">{hint}</span>}
      </div>
      <div className="lp-input">
        <Lock size={17} />
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={MIN_LENGTH}
          autoComplete="new-password"
          autoFocus={autoFocus}
        />
        <button
          type="button"
          className="lp-eye"
          onClick={onToggle}
          aria-label={visible ? `Hide ${toggleName}` : `Show ${toggleName}`}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </div>
  );
}

/**
 * Replacing a temporary password, inside the sign-in card. Shown straight
 * after signing in with one, and whenever an account in that state lands on
 * /login; the app itself stays closed until this succeeds.
 */
export default function ActivatePasswordForm({ email, onActivate, onSwitchAccount }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const longEnough = password.length >= MIN_LENGTH;
  const passwordsMatch = confirmation.length > 0 && password === confirmation;

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("The two passwords do not match.");
      return;
    }
    setSaving(true);
    const result = await onActivate(password);
    // On success the page moves on, so there is nothing to reset.
    if (!result.success) {
      setError(result.error || "Could not activate the account.");
      setSaving(false);
    }
  }

  return (
    <>
      <span className="eyb">First-time account setup</span>
      <h2>Create your permanent password</h2>
      <p className="sub">
        You signed in with a temporary password{email ? <> as <strong>{email}</strong></> : null}.
        Replace it with a private one before entering Trackify.
      </p>

      <form onSubmit={submit}>
        {error && (
          <div className="lp-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        <PasswordField
          id="lp-new-pass"
          label="New password"
          toggleName="new password"
          hint={`At least ${MIN_LENGTH} characters`}
          value={password}
          onChange={setPassword}
          visible={showPassword}
          onToggle={() => setShowPassword((v) => !v)}
          autoFocus
        />
        <PasswordField
          id="lp-new-pass-2"
          label="Repeat new password"
          toggleName="repeated password"
          value={confirmation}
          onChange={setConfirmation}
          visible={showConfirmation}
          onToggle={() => setShowConfirmation((v) => !v)}
        />

        <div
          aria-live="polite"
          style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", margin: "4px 0 20px", fontSize: 12.5 }}
        >
          <Requirement met={longEnough}>{MIN_LENGTH} or more characters</Requirement>
          <Requirement met={passwordsMatch}>Passwords match</Requirement>
        </div>

        <motion.button type="submit" className="lp-submit" disabled={saving} whileTap={{ scale: 0.985 }}>
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
      </form>

      <div style={{ marginTop: 18 }}>
        <button type="button" className="lp-link" style={linkButton} onClick={onSwitchAccount}>
          <ArrowLeft size={14} /> Use a different account
        </button>
      </div>
    </>
  );
}
