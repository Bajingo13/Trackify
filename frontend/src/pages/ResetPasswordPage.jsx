import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { Lock, Eye, EyeOff, ArrowLeft, CheckCircle2, AlertTriangle } from "lucide-react";
import astreablueLogo from "../assets/astreablue-logo.png";
import { checkResetToken, completePasswordReset } from "../services/passwordResetService";
import "../styles/login.css";

/**
 * Where an emailed reset link lands.
 *
 * The link is checked before the form is shown. An expired or already-used
 * link has to say so up front — finding out after carefully typing a new
 * password twice, and then being sent back to the start, is the worst version
 * of this screen.
 */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();

  const [state, setState] = useState("checking"); // checking | ready | dead | done
  const [maskedEmail, setMaskedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setState("dead");
      setError("That link is incomplete. Ask for a new one.");
      return undefined;
    }
    checkResetToken(token)
      .then((res) => {
        if (cancelled) return;
        setMaskedEmail(res.data?.email || "");
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "That link is no longer valid.");
        setState("dead");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      await completePasswordReset(token, password);
      setState("done");
      // Long enough to read the confirmation, then out of the way.
      setTimeout(() => navigate("/login", { replace: true }), 4000);
    } catch (err) {
      setError(err.message || "Could not change your password.");
      // A link the server has now rejected outright cannot be retried.
      if (err.status === 410) setState("dead");
    } finally {
      setSaving(false);
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

          {state === "checking" && (
            <>
              <h2>Checking your link…</h2>
              <p className="sub">One moment.</p>
            </>
          )}

          {state === "dead" && (
            <>
              <span className="eyb" style={{ color: "#c23b3b" }}>Link not usable</span>
              <h2>This link has expired</h2>
              <div className="lp-error" style={{ marginTop: 14 }}>
                <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
              <p className="sub" style={{ marginTop: 14 }}>
                Reset links work once and only for a short time. Your password has not been changed.
              </p>
              <Link to="/forgot-password" className="lp-submit" style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: 8 }}>
                Send me a new link
              </Link>
            </>
          )}

          {state === "done" && (
            <>
              <span className="eyb" style={{ color: "#158a4a" }}>Done</span>
              <h2>Password changed</h2>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 14, fontSize: 14, lineHeight: 1.55 }}>
                <CheckCircle2 size={17} style={{ flexShrink: 0, marginTop: 2, color: "#158a4a" }} />
                <span>
                  You can sign in with your new password now. We have emailed you a confirmation — if
                  that change was not you, tell your administrator straight away.
                </span>
              </div>
              <Link to="/login" className="lp-submit" style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: 20 }}>
                Go to sign in
              </Link>
            </>
          )}

          {state === "ready" && (
            <>
              <span className="eyb">Trip Ticket Management System</span>
              <h2>Choose a new password</h2>
              <p className="sub">
                {maskedEmail ? `For ${maskedEmail}.` : ""} At least 10 characters — a phrase you will
                remember beats a puzzle you will not.
              </p>

              <form onSubmit={submit}>
                {error && (
                  <div className="lp-error">
                    <span>{error}</span>
                  </div>
                )}

                <div className="lp-field">
                  <div className="lp-label-row"><label htmlFor="rp-pass">New password</label></div>
                  <div className="lp-input">
                    <Lock size={17} />
                    <input
                      id="rp-pass"
                      type={show ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="lp-eye"
                      onClick={() => setShow((s) => !s)}
                      aria-label={show ? "Hide password" : "Show password"}
                    >
                      {show ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>

                <div className="lp-field">
                  <div className="lp-label-row"><label htmlFor="rp-confirm">Repeat new password</label></div>
                  <div className="lp-input">
                    <Lock size={17} />
                    <input
                      id="rp-confirm"
                      type={show ? "text" : "password"}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                <motion.button type="submit" className="lp-submit" disabled={saving} whileTap={{ scale: 0.985 }}>
                  {saving ? "Saving…" : "Change my password"}
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
