import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { Mail, ArrowLeft, MailCheck } from "lucide-react";
import astreablueLogo from "../assets/astreablue-logo.png";
import { requestPasswordReset } from "../services/passwordResetService";
import "../styles/login.css";

/**
 * Asking for a reset link.
 *
 * The screen says the same thing whether or not the address belongs to an
 * account, because the server answers the same way — otherwise this page is a
 * way to find out who works here, one address at a time. That is worth a
 * slightly vaguer confirmation than most people expect, so the wording is
 * careful to be useful rather than evasive: it says exactly what to do next
 * and what to do if nothing arrives.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
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

  return (
    <div className="lp">
      <div className="lp-bg" aria-hidden="true">
        <span className="lp-blob a" />
        <span className="lp-blob b" />
      </div>
      <div className="lp-recovery">
        <motion.aside
          className="lp-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          style={{ maxWidth: 440, margin: "0 auto" }}
        >
          <img src={astreablueLogo} alt="" style={{ height: 26, marginBottom: 18 }} />

          {sent ? (
            <>
              <span className="eyb">Check your email</span>
              <h2>Link sent</h2>
              <p className="sub" style={{ marginBottom: 18 }}>
                If that address belongs to an account, a reset link is on its way. It works once and
                expires shortly, so use it as soon as it arrives.
              </p>

              <div
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

              <Link to="/login" className="lp-link" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <ArrowLeft size={14} /> Back to sign in
              </Link>
            </>
          ) : (
            <>
              <span className="eyb">Trip Ticket Management System</span>
              <h2>Forgot your password?</h2>
              <p className="sub">
                Type the email address you sign in with and we will send you a link to choose a new
                password.
              </p>

              <form onSubmit={submit}>
                {error && (
                  <div className="lp-error">
                    <span>{error}</span>
                  </div>
                )}

                <div className="lp-field">
                  <div className="lp-label-row"><label htmlFor="fp-email">Email address</label></div>
                  <div className="lp-input">
                    <Mail size={17} />
                    <input
                      id="fp-email"
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
                  {loading ? "Sending…" : "Send reset link"}
                </motion.button>
              </form>

              <div style={{ marginTop: 18 }}>
                <Link to="/login" className="lp-link" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <ArrowLeft size={14} /> Back to sign in
                </Link>
              </div>
            </>
          )}
        </motion.aside>
      </div>
    </div>
  );
}
