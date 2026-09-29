import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Mail, Lock, Eye, EyeOff, ShieldCheck, ArrowRight, CheckCircle2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import RouteLoader from "../motion/RouteLoader";
import TrackingScene from "../components/login/TrackingScene";
import ForgotPasswordForm from "../components/login/ForgotPasswordForm";
import ActivatePasswordForm from "../components/login/ActivatePasswordForm";
import { checkInvitation } from "../services/passwordResetService";
import astreablueLogo from "../assets/astreablue-logo.png";
import "../styles/login.css";

const REMEMBER_KEY = "tk_login_remember";
const EMAIL_KEY = "tk_login_email";

const EASE_OUT = [0.22, 1, 0.36, 1];

/* Swapping the card's contents between sign in and forgot password. `custom`
   is the direction (1 forward to the reset form, -1 back to sign in), so each
   side slides the way you are going; `still` drops the slide for people who
   ask for reduced motion. */
const cardSwap = {
  enter: ({ dir, still }) => ({ opacity: 0, x: still ? 0 : 24 * dir }),
  center: { opacity: 1, x: 0, transition: { duration: 0.32, ease: EASE_OUT } },
  exit: ({ dir, still }) => ({
    opacity: 0,
    x: still ? 0 : -16 * dir,
    transition: { duration: 0.18, ease: [0.4, 0, 1, 1] },
  }),
};

/* The card's content height, so the card can grow and shrink smoothly instead
   of jumping when the two forms differ in size. */
function useContentHeight() {
  const ref = useRef(null);
  const [height, setHeight] = useState("auto");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, height];
}

/* The invitation behind an /accept-invite link: checked before anything is
   typed, so a dead link says so up front. */
function useInvitation(active, token) {
  const [invite, setInvite] = useState({ state: active ? "checking" : "idle" });
  useEffect(() => {
    if (!active) return undefined;
    if (!token) {
      setInvite({ state: "dead", message: "This invitation link is incomplete. Open it again from the email." });
      return undefined;
    }
    let cancelled = false;
    setInvite({ state: "checking" });
    checkInvitation(token)
      .then((res) => !cancelled && setInvite({ state: "ready", data: res.data }))
      .catch((err) => !cancelled && setInvite({ state: "dead", message: err.message || "This invitation can't be used." }));
    return () => { cancelled = true; };
  }, [active, token]);
  return invite;
}

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
  const [chosenView, setView] = useState("signin");
  const [resizing, setResizing] = useState(false);
  const [bodyRef, bodyHeight] = useContentHeight();
  const still = useReducedMotion();
  const { user, login, completeInitialPassword, acceptInvitation, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  // /accept-invite?token=… — the emailed invitation link opens this same page.
  const inviteToken = pathname === "/accept-invite" ? params.get("token") || "" : "";
  const invite = useInvitation(pathname === "/accept-invite", inviteToken);
  // An invitation link wins; otherwise, signed in with a temporary password
  // (just now, or on an earlier visit), the card asks for a permanent one.
  const view = pathname === "/accept-invite" ? "invite" : user?.mustChangePassword ? "activate" : chosenView;
  const swap = { dir: view === "signin" ? -1 : 1, still };
  const wide = view === "activate" || (view === "invite" && invite.state === "ready");

  async function acceptInvite(newPassword, names) {
    const result = await acceptInvitation(inviteToken, { ...names, newPassword });
    if (result.success) navigate("/dashboard", { replace: true });
    return result;
  }

  function switchAccount() {
    logout();
    setPassword("");
    setView("signin");
  }

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

    if (result.success && result.mustChangePassword) {
      // Stay on this page: the card swaps to the permanent-password form.
      setTimeout(() => {
        setLoading(false);
        setPassword("");
      }, Math.max(0, 500 - (Date.now() - started)));
      return;
    }
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

      <main className={wide ? "lp-main is-wide" : "lp-main"}>
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

          {/* Only the card's contents swap; the page around it stays put.
              While the height animates, the top and bottom are clipped (the
              sides are left open so the slide is not cut); at rest nothing is
              clipped, so focus rings and the button shadow stay whole. */}
          <motion.div
            initial={false}
            animate={{ height: bodyHeight }}
            transition={{ duration: still ? 0 : 0.34, ease: EASE_OUT }}
            onAnimationStart={() => setResizing(true)}
            onAnimationComplete={() => setResizing(false)}
            style={{ clipPath: resizing ? "inset(0 -48px 0 -48px)" : "none" }}
          >
          <div ref={bodyRef}>
          <AnimatePresence mode="wait" initial={false} custom={swap}>
            {view === "activate" ? (
              <motion.div key="activate" custom={swap} variants={cardSwap} initial="enter" animate="center" exit="exit">
                <ActivatePasswordForm
                  user={user}
                  onActivate={completeInitialPassword}
                  onSwitchAccount={switchAccount}
                />
              </motion.div>
            ) : view === "invite" ? (
              <motion.div key={`invite-${invite.state}`} custom={swap} variants={cardSwap} initial="enter" animate="center" exit="exit">
                {invite.state === "ready" ? (
                  <ActivatePasswordForm
                    user={invite.data}
                    onActivate={acceptInvite}
                    onSwitchAccount={() => navigate("/login", { replace: true })}
                    eyebrow="Account invitation"
                    title="Finish your account"
                    intro={
                      `Welcome aboard. ${invite.data.inviterName || "Your administrator"} invited you to Trackify` +
                      `${invite.data.role ? ` as ${invite.data.role}` : ""}. Check your name, then create the ` +
                      "password you’ll use to sign in — nobody else will ever see it."
                    }
                    switchLabel="Back to sign in"
                  />
                ) : invite.state === "dead" ? (
                  <>
                    <span className="eyb">Account invitation</span>
                    <h2>This link can’t be used</h2>
                    <p className="sub" role="alert">{invite.message}</p>
                    <button type="button" className="lp-submit" onClick={() => navigate("/login", { replace: true })}>
                      <span>Go to sign in</span>
                      <ArrowRight size={17} />
                    </button>
                  </>
                ) : (
                  <p className="sub" role="status" style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0" }}>
                    <span className="lp-spinner" style={{ borderColor: "rgba(37,99,235,0.25)", borderTopColor: "var(--accent)" }} />
                    Checking your invitation…
                  </p>
                )}
              </motion.div>
            ) : view === "forgot" ? (
              <motion.div key="forgot" custom={swap} variants={cardSwap} initial="enter" animate="center" exit="exit">
                <ForgotPasswordForm initialEmail={email.trim()} onBack={() => setView("signin")} />
              </motion.div>
            ) : (
              <motion.div key="signin" custom={swap} variants={cardSwap} initial="enter" animate="center" exit="exit">
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
                    {/* Swaps this card to the reset-link form in place; the
                        emailed single-use link still lands on /reset-password. */}
                    <button
                      type="button"
                      className="lp-link"
                      style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" }}
                      onClick={() => { setError(""); setErrorCode(""); setView("forgot"); }}
                    >
                      Forgot password?
                    </button>
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
              </motion.div>
            )}
          </AnimatePresence>
          </div>
          </motion.div>

          <div className="lp-foot">
            <ShieldCheck size={13} />
            <span>Your session is encrypted and access controlled.</span>
          </div>
        </motion.aside>
      </main>
    </div>
  );
}
