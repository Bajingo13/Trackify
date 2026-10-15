import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  PanelLeftClose, PanelLeft, PanelTop, Bell, Search, ChevronDown, LogOut, User,
  Settings,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { loadAlerts } from "../../services/alertsService";
import NotificationPanel from "./NotificationPanel";
import { useMessageNotifications } from "../../services/messageNotifications";
import { usePermissions } from "../../auth/permissions";
import useActiveAccess from "../../hooks/useActiveAccess";
import astreablueLogo from "../../assets/astreablue-logo.png";
import TopNavBar from "./TopNavBar";
import ChatInbox from "./ChatInbox";
import ThemeToggle from "./ThemeToggle";
import { shortcutLabel } from "./searchState";

const CRUMB = {
  dashboard: "Dashboard", operations: "Operations", trips: "Trips", dispatch: "Dispatch",
  "live-tracking": "Live Tracking", exceptions: "Exceptions", fleet: "Fleet", vehicles: "Vehicles",
  drivers: "Drivers", maintenance: "Maintenance", availability: "Availability", compliance: "Compliance",
  "master-data": "Master Data", customers: "Customers", admin: "Administration", companies: "Companies",
  branches: "Branches", users: "Users", roles: "Roles & Permissions", "audit-logs": "Audit Log",
  reports: "Reports", warehouse: "Warehouse", finance: "Finance", settings: "Settings",
  profile: "My Profile", preferences: "Preferences", notifications: "Notifications",
  general: "General Settings", integrations: "Integrations",
};

export default function Topbar({ navMode = "side", collapsed, onToggleCollapsed, onToggleNavMode, onOpenSearch }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const [bell, setBell] = useState(false);
  const [alerts, setAlerts] = useState(null);
  const { can } = usePermissions();
  const ref = useRef(null);
  const bellRef = useRef(null);
  const topMode = navMode === "top";

  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setMenu(false);
      if (bellRef.current && !bellRef.current.contains(e.target)) setBell(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // pull the same alert set the dashboard shows; refresh every 2 min
  useEffect(() => {
    let live = true;
    const pull = () => loadAlerts(can).then((a) => { if (live) setAlerts(a); }).catch(() => { if (live) setAlerts([]); });
    pull();
    const id = setInterval(pull, 120000);
    return () => { live = false; clearInterval(id); };
  }, []);

  // A driver's message is a notification too: it is counted on the bell until
  // its conversation is opened, and the bell swings once when one arrives.
  const messages = useMessageNotifications(can);
  const [ringing, setRinging] = useState(false);
  useEffect(() => {
    if (!messages.arrived) return undefined;
    setRinging(true);
    const id = setTimeout(() => setRinging(false), 1100);
    return () => clearTimeout(id);
  }, [messages.arrived]);

  const alertCount = (alerts?.length || 0) + messages.total;
  const critical = (alerts || []).filter((a) => a.severity === "critical").length;

  const parts = pathname.split("/").filter(Boolean);
  const name = user?.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : "User";
  const role = user?.roles?.[0]?.role_name || "";
  const { current: activeAccess } = useActiveAccess();
  const company = activeAccess?.company_name || "";
  const branch = activeAccess?.branch_name || "";

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
            <img src={astreablueLogo} alt="AstreaBlue" style={{ height: 26, width: "auto", display: "block" }} />
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

        <ThemeToggle />

        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onToggleNavMode}
          title={topMode ? "Switch to sidebar navigation" : "Switch to top-bar navigation"}
          aria-label="Toggle navigation layout"
          style={{ display: "inline-flex", padding: 7, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer", color: "var(--text-2)", borderRadius: "var(--r-xs)" }}
        >
          {topMode ? <PanelLeft size={15} /> : <PanelTop size={15} />}
        </motion.button>

        {onOpenSearch && (
          <button
            onClick={onOpenSearch} aria-label={`Search (${shortcutLabel()})`} title={`Search (${shortcutLabel()})`}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: "var(--r-sm)", color: "var(--text-3)", fontSize: "var(--fs-12)", cursor: "pointer" }}
          >
            <Search size={14} aria-hidden="true" />
            <span>Search</span>
            <kbd style={{ fontSize: 10, border: "1px solid var(--line)", borderRadius: 4, padding: "0 4px" }}>{shortcutLabel()}</kbd>
          </button>
        )}
        <ChatInbox />

        <div style={{ position: "relative" }} ref={bellRef}>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setBell((b) => !b)}
            aria-label={alertCount ? `Notifications (${alertCount})` : "Notifications"}
            aria-expanded={bell}
            style={{ position: "relative", padding: 7, border: "none", background: bell ? "var(--surface-sunk)" : "transparent", cursor: "pointer", color: bell ? "var(--text)" : "var(--text-2)", borderRadius: "var(--r-xs)" }}
          >
            <motion.span
              style={{ display: "inline-flex", transformOrigin: "50% 10%" }}
              animate={ringing ? { rotate: [0, 16, -14, 10, -6, 3, 0] } : { rotate: 0 }}
              transition={{ duration: 1 }}
            >
              <Bell size={16} />
            </motion.span>
            {alertCount > 0 && (
              <span
                style={{
                  position: "absolute", top: 2, right: 2, minWidth: 15, height: 15, padding: "0 3px",
                  borderRadius: "var(--r-pill)", background: critical ? "var(--danger)" : messages.total ? "var(--accent)" : "var(--warn)",
                  color: "#fff", fontSize: 9, fontWeight: 700, lineHeight: "15px", textAlign: "center",
                  border: "2px solid var(--surface)", boxSizing: "content-box",
                }}
              >
                {alertCount > 9 ? "9+" : alertCount}
              </span>
            )}
          </motion.button>

          <AnimatePresence>
            {bell && (
              <motion.div
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.14 }}
                className="tc-inbox"
              >
                <NotificationPanel
                  alerts={alerts}
                  chats={messages.chats}
                  support={messages.support}
                  onOpen={(href) => { setBell(false); navigate(href); }}
                  onDashboard={() => { setBell(false); navigate("/dashboard"); }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

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
                  onClick={() => { navigate("/admin/settings"); setMenu(false); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", border: "none", background: "transparent", cursor: "pointer", color: "var(--text-2)", fontSize: "var(--fs-13)", fontWeight: 500 }}
                >
                  <Settings size={14} /> Account Settings
                </button>
                <button
                  onClick={() => { onToggleNavMode(); setMenu(false); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", border: "none", borderTop: "1px solid var(--line)", background: "transparent", cursor: "pointer", color: "var(--text-2)", fontSize: "var(--fs-13)", fontWeight: 500 }}
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
