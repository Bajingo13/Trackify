import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Mail, Lock, Eye, EyeOff, Truck, MapPin, ClipboardList, Users, ShieldCheck,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

const features = [
  {
    icon: ClipboardList,
    title: "Trip Management",
    desc: "Create and organize trip tickets, track status, and keep all dispatch records in one place.",
  },
  {
    icon: Truck,
    title: "Smart Dispatch",
    desc: "Assign the right driver to the right trip, optimize routes, and reduce delivery delays.",
  },
  {
    icon: Users,
    title: "Driver Management",
    desc: "View driver profiles, monitor availability, and manage assignments with ease.",
  },
  {
    icon: MapPin,
    title: "Real-time Tracking",
    desc: "Track every active trip and driver location on a live map for full visibility.",
  },
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const { login } = useAuth();
  const navigate = useNavigate();

  const nextSlide = useCallback(() => {
    setActiveSlide((prev) => (prev + 1) % features.length);
  }, []);

  useEffect(() => {
    const timer = setInterval(nextSlide, 4000);
    return () => clearInterval(timer);
  }, [nextSlide]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    const result = login(email, password);
    setLoading(false);
    if (result.success) {
      navigate("/dashboard", { replace: true });
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="login-page">
      {/* ─── LEFT PANEL ─── */}
      <div className="login-left">
        <div className="login-left-content">

          {/* Brand Icon */}
          <div className="login-brand-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 17H7A5 5 0 0 1 7 7h2" />
              <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </div>

          {/* Heading */}
          <h1 className="login-title">
            <span className="login-title-dark">Trip Ticket</span>
            <br />
            <span className="login-title-blue">Management System</span>
          </h1>

          <p className="login-subtitle">
            Streamline your trips, dispatch, and tracking with real-time visibility and control.
          </p>

          {/* Feature Carousel */}
          <div className="login-carousel">
            <div className="login-carousel-track">
              {features.map((f, i) => {
                const Icon = f.icon;
                return (
                  <div
                    key={f.title}
                    className={`login-carousel-slide ${i === activeSlide ? "active" : ""}`}
                  >
                    <div className="login-feature-card">
                      <div className="login-feature-icon">
                        <Icon size={17} strokeWidth={1.8} />
                      </div>
                      <div className="login-feature-text">
                        <div className="login-feature-title">{f.title}</div>
                        <div className="login-feature-desc">{f.desc}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="login-carousel-dots">
              {features.map((f, i) => (
                <button
                  key={f.title}
                  className={`login-carousel-dot ${i === activeSlide ? "active" : ""}`}
                  onClick={() => setActiveSlide(i)}
                  aria-label={`Go to ${f.title}`}
                />
              ))}
            </div>
          </div>

          {/* Logistics Illustration */}
          <div className="login-illustration">
            <svg viewBox="0 0 700 180" fill="none" xmlns="http://www.w3.org/2000/svg" className="login-city-svg">
              {/* Sky clouds */}
              <ellipse cx="120" cy="40" rx="40" ry="12" fill="#DDE5F1" opacity="0.5" />
              <ellipse cx="150" cy="36" rx="30" ry="10" fill="#DDE5F1" opacity="0.4" />
              <ellipse cx="480" cy="30" rx="35" ry="11" fill="#DDE5F1" opacity="0.45" />
              <ellipse cx="510" cy="26" rx="25" ry="9" fill="#DDE5F1" opacity="0.35" />
              <ellipse cx="300" cy="22" rx="28" ry="9" fill="#DDE5F1" opacity="0.3" />

              {/* City skyline */}
              <rect x="30" y="90" width="28" height="90" rx="3" fill="#C5D0E6" opacity="0.35" />
              <rect x="65" y="60" width="22" height="120" rx="3" fill="#B8C5DE" opacity="0.3" />
              <rect x="95" y="80" width="30" height="100" rx="3" fill="#C5D0E6" opacity="0.35" />
              <rect x="133" y="50" width="18" height="130" rx="3" fill="#B8C5DE" opacity="0.25" />
              <rect x="158" y="70" width="35" height="110" rx="3" fill="#C5D0E6" opacity="0.3" />
              <rect x="200" y="45" width="22" height="135" rx="3" fill="#B8C5DE" opacity="0.25" />
              <rect x="230" y="65" width="26" height="115" rx="3" fill="#C5D0E6" opacity="0.35" />
              <rect x="264" y="55" width="20" height="125" rx="3" fill="#B8C5DE" opacity="0.3" />
              <rect x="292" y="75" width="32" height="105" rx="3" fill="#C5D0E6" opacity="0.25" />
              <rect x="332" y="42" width="18" height="138" rx="3" fill="#B8C5DE" opacity="0.3" />
              <rect x="358" y="60" width="28" height="120" rx="3" fill="#C5D0E6" opacity="0.35" />
              <rect x="394" y="48" width="22" height="132" rx="3" fill="#B8C5DE" opacity="0.25" />
              <rect x="424" y="68" width="30" height="112" rx="3" fill="#C5D0E6" opacity="0.3" />
              <rect x="462" y="38" width="16" height="142" rx="3" fill="#B8C5DE" opacity="0.3" />
              <rect x="486" y="58" width="25" height="122" rx="3" fill="#C5D0E6" opacity="0.25" />
              <rect x="518" y="46" width="20" height="134" rx="3" fill="#B8C5DE" opacity="0.35" />
              <rect x="546" y="64" width="28" height="116" rx="3" fill="#C5D0E6" opacity="0.3" />
              <rect x="582" y="52" width="22" height="128" rx="3" fill="#B8C5DE" opacity="0.25" />
              <rect x="612" y="72" width="26" height="108" rx="3" fill="#C5D0E6" opacity="0.35" />

              {/* Road */}
              <path d="M0 170 Q175 145 350 155 Q525 165 700 148" stroke="#B8C5DE" strokeWidth="2.5" fill="none" />
              <path d="M0 175 Q175 150 350 160 Q525 170 700 153" stroke="#DDE5F1" strokeWidth="1.5" fill="none" strokeDasharray="6 8" />

              {/* Route line (dashed) */}
              <path d="M180 162 C240 148 320 158 400 150 C480 142 540 152 600 145" stroke="#123EB5" strokeWidth="2" fill="none" strokeDasharray="5 5" opacity="0.6" />

              {/* Truck body */}
              <g transform="translate(220, 130)">
                {/* Cargo */}
                <rect x="0" y="2" width="44" height="26" rx="3" fill="#071C58" />
                <rect x="2" y="4" width="40" height="10" rx="1.5" fill="#123EB5" opacity="0.4" />
                {/* Cabin */}
                <rect x="42" y="8" width="16" height="20" rx="2.5" fill="#0A2A83" />
                {/* Window */}
                <rect x="44" y="10" width="12" height="8" rx="1.5" fill="#3975F6" opacity="0.35" />
                {/* Wheels */}
                <circle cx="10" cy="30" r="4.5" fill="#081638" />
                <circle cx="10" cy="30" r="2.2" fill="#64718F" />
                <circle cx="48" cy="30" r="4.5" fill="#081638" />
                <circle cx="48" cy="30" r="2.2" fill="#64718F" />
              </g>

              {/* Destination pin */}
              <g transform="translate(548, 108)">
                <path d="M14 0C6.26 0 0 6.26 0 14c0 10.5 14 23 14 23s14-12.5 14-23C28 6.26 21.74 0 14 0z" fill="#123EB5" />
                <circle cx="14" cy="13" r="5.5" fill="white" />
                <circle cx="14" cy="13" r="2.5" fill="#123EB5" />
              </g>

              {/* Small trees/bushes */}
              <circle cx="100" cy="162" r="6" fill="#B8C5DE" opacity="0.4" />
              <circle cx="380" cy="155" r="5" fill="#B8C5DE" opacity="0.35" />
              <circle cx="650" cy="150" r="6" fill="#B8C5DE" opacity="0.3" />
            </svg>
          </div>
        </div>
      </div>

      {/* ─── RIGHT PANEL (background) ─── */}
      <div className="login-right" />

      {/* ─── FLOATING FORM ─── */}
      <div className="login-floating-form">
        <div className="login-form-card">

          {/* AstreaBlue Logo */}
          <div className="login-form-logo">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L14.09 7.26L20 8.27L15.55 12.14L16.91 18.02L12 15.27L7.09 18.02L8.45 12.14L4 8.27L9.91 7.26L12 2Z" fill="#0A2A83" stroke="#071C58" strokeWidth="0.5" />
            </svg>
            <span className="login-form-logo-text">AstreaBlue</span>
          </div>

          {/* Heading */}
          <h2 className="login-form-title">Welcome back</h2>
          <p className="login-form-desc">Sign in to access your Trip Ticket Management System</p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="login-form">
            {error && (
              <div className="login-error">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Email */}
            <div className="login-field">
              <label className="login-label">Email Address</label>
              <div className="login-input-wrapper">
                <Mail size={17} className="login-input-icon" />
                <input
                  type="email"
                  className="login-input"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div className="login-field">
              <label className="login-label">Password</label>
              <div className="login-input-wrapper">
                <Lock size={17} className="login-input-icon" />
                <input
                  type={showPassword ? "text" : "password"}
                  className="login-input"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="login-eye-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {/* Remember + Forgot */}
            <div className="login-options">
              <label className="login-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="login-checkbox"
                />
                <span>Remember me</span>
              </label>
              <a href="#" className="login-forgot">Forgot password?</a>
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="login-submit"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="login-spinner" />
                  <span>Signing in...</span>
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          {/* Security note */}
          <div className="login-security">
            <ShieldCheck size={13} />
            <span>Secure access to AstreaBlue Trip Ticket Management System</span>
          </div>
        </div>
      </div>
    </div>
  );
}
