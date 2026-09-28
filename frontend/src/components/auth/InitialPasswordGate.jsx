import { useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck, Truck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../ui";
import TrackingScene from "../login/TrackingScene";
import astreablueLogo from "../../assets/astreablue-logo.png";
import "./initial-password-gate.css";

const BACKGROUND_TRUCKS = [
  { x: "5%", direction: "down", speed: "24s", delay: "-8s", size: 18, opacity: 0.1, drift: "12px" },
  { x: "12%", direction: "up", speed: "29s", delay: "-18s", size: 21, opacity: 0.08, drift: "-10px" },
  { x: "19%", direction: "down", speed: "31s", delay: "-23s", size: 16, opacity: 0.08, drift: "8px" },
  { x: "27%", direction: "up", speed: "26s", delay: "-5s", size: 19, opacity: 0.11, drift: "11px" },
  { x: "35%", direction: "down", speed: "34s", delay: "-16s", size: 22, opacity: 0.07, drift: "-13px" },
  { x: "43%", direction: "up", speed: "28s", delay: "-12s", size: 17, opacity: 0.09, drift: "-8px" },
  { x: "51%", direction: "down", speed: "27s", delay: "-20s", size: 20, opacity: 0.1, drift: "10px" },
  { x: "59%", direction: "up", speed: "33s", delay: "-9s", size: 18, opacity: 0.07, drift: "12px" },
  { x: "67%", direction: "down", speed: "30s", delay: "-3s", size: 21, opacity: 0.09, drift: "-11px" },
  { x: "75%", direction: "up", speed: "25s", delay: "-17s", size: 16, opacity: 0.1, drift: "-7px" },
  { x: "83%", direction: "down", speed: "32s", delay: "-13s", size: 19, opacity: 0.08, drift: "9px" },
  { x: "92%", direction: "up", speed: "28s", delay: "-22s", size: 22, opacity: 0.08, drift: "-12px" },
];

export default function InitialPasswordGate({ children }) {
  const { user, completeInitialPassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  if (!user?.mustChangePassword) return children;

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Trackify user";
  const role = user?.roles?.[0]?.role_name || "Authorized fleet user";
  const initial = user?.firstName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "U";
  const longEnough = password.length >= 10;
  const passwordsMatch = confirmation.length > 0 && password === confirmation;

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("The two passwords do not match.");
      return;
    }
    setSaving(true);
    const result = await completeInitialPassword(password);
    if (!result.success) setError(result.error);
    setSaving(false);
  }

  return (
    <main className="ipg">
      <div className="ipg-background" aria-hidden="true">
        <div className="ipg-truck-streams">
          {BACKGROUND_TRUCKS.map((truck, index) => (
            <span
              className={`ipg-bg-truck is-${truck.direction}`}
              key={`${truck.x}-${truck.direction}`}
              style={{
                "--truck-x": truck.x,
                "--truck-speed": truck.speed,
                "--truck-delay": truck.delay,
                "--truck-size": `${truck.size}px`,
                "--truck-opacity": truck.opacity,
                "--truck-drift": truck.drift,
              }}
            >
              <Truck size={truck.size} strokeWidth={1.65 + (index % 2) * 0.2} />
            </span>
          ))}
        </div>
      </div>

      <header className="ipg-header">
        <div className="ipg-brand">
          <img src={astreablueLogo} alt="AstreaBlue" />
          <span />
          <small>Trip Ticket Management System</small>
        </div>
        <div className="ipg-secure"><ShieldCheck size={14} /> Secure account activation</div>
      </header>

      <div className="ipg-layout">
        <section className="ipg-hero" aria-label="Trackify live fleet preview">
          <div className="ipg-eyebrow"><i /> Live fleet workspace</div>
          <h2>Secure access for the road ahead.</h2>
          <p>
            Set your permanent password before entering the workspace used to plan,
            dispatch, and monitor every trip.
          </p>
          <div className="ipg-scene">
            <TrackingScene />
          </div>
        </section>

        <section className="ipg-card" aria-labelledby="ipg-title">
          <div className="ipg-user">
            <span className="ipg-avatar" aria-hidden="true">{initial}</span>
            <div>
              <small>Activating access for</small>
              <strong>{fullName}</strong>
              <span>{user?.email || role}</span>
            </div>
            <ShieldCheck size={18} aria-label="Verified session" />
          </div>

          <div className="ipg-key" aria-hidden="true"><KeyRound size={22} /></div>
          <span className="ipg-step">First-time account setup</span>
          <h1 id="ipg-title">Create your permanent password</h1>
          <p className="ipg-copy">
            Your temporary password worked. Replace it now with a private password
            before entering Trackify.
          </p>

          <form onSubmit={submit} className="ipg-form">
            {error && <div role="alert" className="ipg-error">{error}</div>}

            <label className="ipg-field">
              <span><b>New password</b><small>Minimum 10 characters</small></span>
              <span className="ipg-input">
                <LockKeyhole size={16} aria-hidden="true" />
                <input
                  aria-label="New password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={10}
                />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide new password" : "Show new password"}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>

            <label className="ipg-field">
              <span><b>Repeat new password</b><small>Type it again to confirm</small></span>
              <span className="ipg-input">
                <LockKeyhole size={16} aria-hidden="true" />
                <input
                  aria-label="Repeat new password"
                  type={showConfirmation ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  required
                  minLength={10}
                />
                <button type="button" onClick={() => setShowConfirmation((visible) => !visible)} aria-label={showConfirmation ? "Hide repeated password" : "Show repeated password"}>
                  {showConfirmation ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>

            <div className="ipg-requirements" aria-live="polite">
              <span className={longEnough ? "met" : ""}><Check size={12} /> 10 or more characters</span>
              <span className={passwordsMatch ? "met" : ""}><Check size={12} /> Passwords match</span>
            </div>

            <Button
              className="ipg-submit"
              type="submit"
              variant="primary"
              size="lg"
              loading={saving}
              iconRight={<ArrowRight size={16} />}
            >
              Activate account
            </Button>
          </form>

          <div className="ipg-foot"><ShieldCheck size={13} /> Your password is encrypted and never shown to other users.</div>
        </section>
      </div>
    </main>
  );
}
