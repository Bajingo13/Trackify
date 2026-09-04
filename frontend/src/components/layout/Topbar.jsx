import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  PanelLeftClose, PanelLeft, PanelTop, Bell, ChevronDown, LogOut, User, Truck,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import TopNavBar from "./TopNavBar";

const CRUMB = {
  dashboard: "Dashboard", operations: "Operations", trips: "Trips", dispatch: "Dispatch",
  "live-tracking": "Live Tracking", exceptions: "Exceptions", fleet: "Fleet", vehicles: "Vehicles",
  drivers: "Drivers", maintenance: "Maintenance", availability: "Availability", compliance: "Compliance",
  "master-data": "Master Data", customers: "Customers", admin: "Administration", companies: "Companies",
  branches: "Branches", users: "Users", roles: "Roles & Permissions", "audit-logs": "Audit Log",
  reports: "Reports", warehouse: "Warehouse", finance: "Finance",
};

export default function Topbar({ navMode = "side", collapsed, onToggleCollapsed, onToggleNavMode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const ref = useRef(null);
  const topMode = navMode === "top";

  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setMenu(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const parts = pathname.split("/").filter(Boolean);
  const name = user?.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : "User";
  const role = user?.roles?.[0]?.role_name || "";
  const company = user?.access?.[0]?.company_name || "";
  const branch = user?.access?.[0]?.branch_name || "";

  return (
    <header
      className="tk-scope"
      style={{
        position: "sticky", top: 0, zIndex: 40, height: "var(--topbar-h)", flexShrink: 0,
        display: "flex", alignItems: "center", gap: "var(--s-3)", padding: "0 var(--s-5)",
        borderBottom: "1px solid var(--line)",
        background: "color-mix(in srgb, var(--surface) 85%, transparent)",
        backdropFilter: "blur(10px)",
      }}
    >
      {topMode ? (
        <>
          <button
            onClick={() => navigate("/dashboard")}
            style={{ display: "flex", alignItems: "center", gap: 9, border: "none", background: "transparent", cursor: "pointer", flexShrink: 0, paddingRight: 6 }}
          >
            <span style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, var(--brand-blue), var(--brand-navy))", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
              <Truck size={15} />
            </span>
            <span style={{ fontFamily: "var(--font-pixel)", fontWeight: 400, fontSize: 15, letterSpacing: "0.5px", color: "var(--text)" }}>Trackify</span>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TopNavBar />
          </div>
        </>
      ) : (
        <>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onToggleCollapsed}
            style={{ display: "inline-flex", padding: 6, border: "none", background: "transparent", cursor: "pointer", color: "var(--text-2)", borderRadius: "var(--r-xs)" }}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeft size={17} /> : <PanelLeftClose size={17} />}
          </motion.button>

          <nav style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-13)", minWidth: 0, overflow: "hidden" }}>
            {parts.map((p, i) => {
              const last = i === parts.length - 1;
              return (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                {i > 0 && <span style={{ color: "var(--text-3)" }}>/</span>}
                <span style={{
                  color: last ? "var(--text)" : "var(--text-2)",
                  fontWeight: last ? 400 : 500,
                  fontFamily: last ? "var(--font-pixel)" : undefined,
                  fontSize: last ? 13 : undefined,
                  letterSpacing: last ? "0.4px" : undefined,
                }}>
                  {CRUMB[p] || p.replace(/-/g, " ")}
                </span>
              </span>
              );
            })}
          </nav>
        </>
      )}

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--s-2)", flexShrink: 0 }}>
        {company && !topMode && (
          <span className="tk-mono" style={{ fontSize: "var(--fs-11)", color: "var(--text-3)", padding: "3px 9px", border: "1px solid var(--line)", borderRadius: "var(--r-pill)", whiteSpace: "nowrap" }}>
            {company}{branch ? ` · ${branch}` : ""}
          </span>
        )}

        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onToggleNavMode}
          title={topMode ? "Switch to sidebar navigation" : "Switch to top-bar navigation"}
          aria-label="Toggle navigation layout"
          style={{ display: "inline-flex", padding: 7, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer", color: "var(--text-2)", borderRadius: "var(--r-xs)" }}
        >
          {topMode ? <PanelLeft size={15} /> : <PanelTop size={15} />}
        </motion.button>

        <motion.button whileTap={{ scale: 0.9 }} style={{ position: "relative", padding: 7, border: "none", background: "transparent", cursor: "pointer", color: "var(--text-2)", borderRadius: "var(--r-xs)" }} aria-label="Notifications">
          <Bell size={16} />
        </motion.button>

        <div style={{ position: "relative" }} ref={ref}>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setMenu((m) => !m)}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 9px 5px 6px", border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer", borderRadius: "var(--r-sm)" }}
          >
            <span style={{ width: 24, height: 24, borderRadius: "50%", background: "linear-gradient(135deg, var(--brand-blue), var(--brand-navy))", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
              {user?.firstName?.[0]?.toUpperCase() || <User size={12} />}
            </span>
            <span style={{ textAlign: "left", lineHeight: 1.2 }}>
              <span style={{ display: "block", fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--text)" }}>{name}</span>
              <span style={{ display: "block", fontSize: "var(--fs-11)", color: "var(--text-3)" }}>{role}</span>
            </span>
            <ChevronDown size={13} style={{ color: "var(--text-3)" }} />
          </motion.button>

          <AnimatePresence>
            {menu && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.16 }}
                style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 224, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", boxShadow: "var(--shadow-3)", overflow: "hidden", zIndex: 60 }}
              >
                <div style={{ padding: "12px 14px", background: "var(--surface-2)", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text)" }}>{name}</div>
                  <div style={{ fontSize: "var(--fs-11)", color: "var(--text-3)" }}>{user?.email}</div>
                  {company && <div style={{ marginTop: 6, fontSize: "var(--fs-11)", color: "var(--text-3)" }} className="tk-mono">{company}{branch ? ` · ${branch}` : ""}</div>}
                </div>
                <button
                  onClick={() => { onToggleNavMode(); setMenu(false); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", border: "none", background: "transparent", cursor: "pointer", color: "var(--text-2)", fontSize: "var(--fs-13)", fontWeight: 500 }}
                >
                  {topMode ? <PanelLeft size={14} /> : <PanelTop size={14} />}
                  {topMode ? "Use sidebar navigation" : "Use top-bar navigation"}
                </button>
                <button
                  onClick={() => { logout(); navigate("/login", { replace: true }); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", border: "none", borderTop: "1px solid var(--line)", background: "transparent", cursor: "pointer", color: "var(--danger)", fontSize: "var(--fs-13)", fontWeight: 500 }}
                >
                  <LogOut size={14} /> Sign out
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
