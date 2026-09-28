import { useState } from "react";
import { motion } from "motion/react";
import { Mail, ArrowLeft, MailCheck } from "lucide-react";
import { requestPasswordReset } from "../../services/passwordResetService";

/* The card's links are buttons here (nothing to navigate to), so they drop the
   native button chrome and keep the .lp-link look. */
const linkButton = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer",
};

/**
 * Asking for a reset link from inside the sign-in card, so the page around it
 * stays put. Same wording rules as ForgotPasswordPage: the confirmation reads
 * the same whether or not the address has an account, because the server
 * answers the same way.
 */
export default function ForgotPasswordForm({ initialEmail = "", onBack }) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err.message || "Could not send that. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  const back = (
    <button type="button" className="lp-link" style={linkButton} onClick={onBack}>
      <ArrowLeft size={14} /> Back to sign in
    </button>
  );

  if (sent) {
    return (
      <>
        <span className="eyb">Check your email</span>
        <h2>Link sent</h2>
        <p className="sub" style={{ marginBottom: 18 }}>
          If that address belongs to an account, a reset link is on its way. It works once and
          expires shortly, so use it as soon as it arrives.
        </p>

        <div
          role="status"
          style={{
            display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px",
            borderRadius: 10, background: "rgba(36,85,214,0.07)", marginBottom: 18,
            fontSize: 13, lineHeight: 1.5,
          }}
        >
          <MailCheck size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            Nothing after a few minutes? Check the spam folder, then ask your administrator —
            the address may not be the one on your account.
          </span>
        </div>

        {back}
      </>
    );
  }

  return (
    <>
      <span className="eyb">Trip Ticket Management System</span>
      <h2>Forgot your password?</h2>
      <p className="sub">
        Type the email address you sign in with and we will send you a link to choose a new password.
      </p>

      <form onSubmit={submit}>
        {error && (
          <div className="lp-error">
            <span>{error}</span>
          </div>
        )}

        <div className="lp-field">
          <div className="lp-label-row"><label htmlFor="lp-fp-email">Email address</label></div>
          <div className="lp-input">
            <Mail size={17} />
            <input
              id="lp-fp-email"
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              autoFocus
            />
          </div>
        </div>

        <motion.button type="submit" className="lp-submit" disabled={loading} whileTap={{ scale: 0.985 }}>
          {loading ? (
            <>
              <span className="lp-spinner" />
              <span>Sending…</span>
            </>
          ) : (
            <span>Send reset link</span>
          )}
        </motion.button>
      </form>

      <div style={{ marginTop: 18 }}>{back}</div>
    </>
  );
}
