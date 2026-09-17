import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { Mail, Lock, Eye, EyeOff, ShieldCheck, ArrowRight, CheckCircle2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import RouteLoader from "../motion/RouteLoader";
import TrackingScene from "../components/login/TrackingScene";
import astreablueLogo from "../assets/astreablue-logo.png";
import "../styles/login.css";

const REMEMBER_KEY = "tk_login_remember";
const EMAIL_KEY = "tk_login_email";

const CHECKS = [
  "Real-time operational visibility",
  "One source of truth for every trip",
  "Secure, role-based access",
];

export default function LoginPage() {
  const rememberedEmail = (() => {
    try {
      return localStorage.getItem(REMEMBER_KEY) === "0" ? "" : localStorage.getItem(EMAIL_KEY) || "";
    } catch {
      return "";
    }
  })();

  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(() => {
    try { return localStorage.getItem(REMEMBER_KEY) !== "0"; } catch { return true; }
  });
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setErrorCode("");
    setLoading(true);

    try {
      localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
      if (remember) localStorage.setItem(EMAIL_KEY, email.trim());
      else localStorage.removeItem(EMAIL_KEY);
    } catch { /* storage unavailable — proceed without remembering */ }

    const started = Date.now();
    const result = await login(email, password);

    if (result.success) {
      const wait = Math.max(0, 5000 - (Date.now() - started));
      setTimeout(() => navigate("/dashboard", { replace: true }), wait);
      return; // keep the loader mounted through navigation
    }
    setTimeout(() => {
      setLoading(false);
      setError(result.error);
      setErrorCode(result.code || "");
    }, Math.max(0, 500 - (Date.now() - started)));
  }

  return (
    <div className="lp">
      <AnimatePresence>
        {loading && <RouteLoader key="signin-loader" label="Signing you in" />}
      </AnimatePresence>

      <div className="lp-bg">
        <span className="lp-blob a" />
        <span className="lp-blob b" />
      </div>

      <header className="lp-top">
        <div className="lp-brand">
          <img src={astreablueLogo} alt="AstreaBlue" />
          <span className="lp-brand-divider" />
          <small>Trip Ticket<br />Management System</small>
        </div>
        <span className="lp-top-tag">Authorized access only</span>
      </header>

      <main className="lp-main">
        <motion.section
          className="lp-hero"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="lp-eyebrow">Connected Fleet Operations</span>
          <h1>
            Every trip.<br />
            <span className="grad">Clearly managed.</span>
          </h1>
          <p>
            Plan, dispatch, monitor, and report from one reliable workspace built for
            modern transportation teams.
          </p>

          <ul className="lp-checks">
            {CHECKS.map((c) => (
              <li key={c}><CheckCircle2 size={16} strokeWidth={2.2} /> {c}</li>
            ))}
          </ul>

          <div className="lp-scene-wrap">
            <TrackingScene />
          </div>
        </motion.section>

        <motion.aside
          className="lp-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="lp-card-status"><i /> Encrypted session</span>
          <span className="eyb">Trip Ticket Management System</span>
          <h2>Sign in to continue</h2>
          <p className="sub">Use your authorized company account.</p>

          <form onSubmit={handleSubmit}>
            {error && (
              <div className="lp-error">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                <span>
                  {errorCode === "DRIVER_APP_ONLY" ? (
                    <>This account only has Driver App access. Sign in at <a href="/driver" style={{ color: "inherit", textDecoration: "underline" }}>/driver</a> with your employee number and PIN instead.</>
                  ) : error}
                </span>
              </div>
            )}

            <div className="lp-field">
              <div className="lp-label-row"><label htmlFor="lp-email">Email address</label></div>
              <div className="lp-input">
                <Mail size={17} />
                <input
                  id="lp-email"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="lp-field">
              <div className="lp-label-row">
                <label htmlFor="lp-pass">Password</label>
                <span className="lp-hint">Case-sensitive</span>
              </div>
              <div className="lp-input">
                <Lock size={17} />
                <input
                  id="lp-pass"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="lp-eye"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <div className="lp-row">
              <label className="lp-check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>Remember me</span>
              </label>
              <a href="#" className="lp-link">Forgot password?</a>
            </div>

            <motion.button
              type="submit"
              className="lp-submit"
              disabled={loading}
              whileTap={{ scale: 0.985 }}
            >
              {loading ? (
                <>
                  <span className="lp-spinner" />
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  <span>Sign in securely</span>
                  <ArrowRight size={17} />
                </>
              )}
            </motion.button>
          </form>

          <div className="lp-foot">
            <ShieldCheck size={13} />
            <span>Your session is encrypted and access controlled.</span>
          </div>
        </motion.aside>
      </main>
    </div>
  );
}
