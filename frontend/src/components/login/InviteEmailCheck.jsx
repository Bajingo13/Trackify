import { useId, useState } from "react";
import { motion } from "motion/react";
import { Mail, ArrowRight, ArrowLeft, AlertCircle } from "lucide-react";

const linkButton = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer",
};

/**
 * First step of an invitation: the link alone is not proof of who is holding
 * it, so the person types the full address it was sent to. Only then does the
 * server reveal the invitation. Wrong answers are counted against the link.
 */
export default function InviteEmailCheck({ maskedEmail, attemptsLeft, onVerify, onBack }) {
  const uid = useId();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const canSubmit = email.trim().includes("@") && !checking;

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setChecking(true);
    const result = await onVerify(email.trim());
    // On success the card moves on, so there is nothing to reset.
    if (!result?.success) {
      setError(result?.error || "Could not check the email address.");
      setChecking(false);
    }
  }

  return (
    <>
      <span className="eyb">Account invitation</span>
      <h2>Confirm it’s you</h2>
      <p className="sub">
        This invitation was sent to <strong>{maskedEmail}</strong>. Type the full address to continue.
        {attemptsLeft < 5 && ` ${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left.`}
      </p>

      <form onSubmit={submit} noValidate>
        {error && (
          <div className="lp-error" role="alert">
            <AlertCircle size={15} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="lp-field">
          <div className="lp-label-row"><label htmlFor={`${uid}-email`}>Email address</label></div>
          <div className="lp-input">
            <Mail size={17} />
            <input
              id={`${uid}-email`}
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              autoFocus
              required
            />
          </div>
        </div>

        <motion.button
          type="submit"
          className="lp-submit"
          disabled={!canSubmit}
          whileTap={canSubmit ? { scale: 0.985 } : undefined}
          style={{ marginTop: 6 }}
        >
          {checking ? (
            <>
              <span className="lp-spinner" />
              <span>Checking…</span>
            </>
          ) : (
            <>
              <span>Continue</span>
              <ArrowRight size={17} />
            </>
          )}
        </motion.button>
      </form>

      <div style={{ marginTop: 18 }}>
        <button type="button" className="lp-link" style={linkButton} onClick={onBack}>
          <ArrowLeft size={14} /> Back to sign in
        </button>
      </div>
    </>
  );
}
