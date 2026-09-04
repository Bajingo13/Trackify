import { useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  LayoutDashboard, Truck, Route, Warehouse, Wallet, Database, BarChart3,
  ShieldCheck, ChevronDown, ScrollText,
} from "lucide-react";
import navigation, { filterNavigation } from "../../data/navigationConfig";
import { usePermissions } from "../../auth/permissions";

const GROUP_ICON = {
  Operations: Route,
  Fleet: Truck,
  Warehouse: Warehouse,
  Finance: Wallet,
  "Master Data": Database,
  Reports: BarChart3,
  Administration: ShieldCheck,
  "Audit Log": ScrollText,
};

export default function Sidebar({ collapsed }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const items = useMemo(() => filterNavigation(navigation, can), [can]);

  const activeGroup = items.find((g) => g.children?.some((c) => pathname.startsWith(c.path)))?.label;
  const [open, setOpen] = useState(() => (activeGroup ? { [activeGroup]: true } : {}));

  return (
    <nav
      className="tk-scope"
      style={{
        width: collapsed ? "var(--sidebar-w-collapsed)" : "var(--sidebar-w)",
        flexShrink: 0,
        borderRight: "1px solid var(--line)",
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
        position: "sticky",
        top: 0,
        height: "100vh",
        transition: "width var(--dur-3) var(--ease-out)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => navigate("/dashboard")}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "0 16px", height: "var(--topbar-h)",
          border: "none", borderBottom: "1px solid var(--line)", background: "transparent", cursor: "pointer", flexShrink: 0,
        }}
      >
        <span style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, var(--brand-blue), var(--brand-navy))", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0 }}>
          <Truck size={15} />
        </span>
        {!collapsed && <span style={{ fontFamily: "var(--font-pixel)", fontWeight: 400, fontSize: "15px", letterSpacing: "0.5px", color: "var(--text)" }}>Trackify</span>}
      </button>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
        <SideLink to="/dashboard" icon={LayoutDashboard} label="Dashboard" collapsed={collapsed} pathname={pathname} />

        {items.map((group) => {
          if (!group.children) {
            return <SideLink key={group.label} to={group.path} icon={GROUP_ICON[group.label]} label={group.label} collapsed={collapsed} pathname={pathname} />;
          }
          const Icon = GROUP_ICON[group.label] || Route;
          // collapsed rail: the group icon jumps to its first page
          if (collapsed) {
            return <SideLink key={group.label} to={group.children[0].path} icon={Icon} label={group.label} collapsed pathname={pathname} groupPaths={group.children.map((c) => c.path)} />;
          }
          const isOpen = !!open[group.label];
          const groupActive = group.children.some((c) => pathname.startsWith(c.path));
          return (
            <div key={group.label}>
              <button
                onClick={() => setOpen((o) => ({ ...o, [group.label]: !o[group.label] }))}
                title={collapsed ? group.label : undefined}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                  border: "none", background: "transparent", cursor: "pointer", borderRadius: "var(--r-sm)",
                  color: groupActive ? "var(--text)" : "var(--text-2)", fontSize: "var(--fs-13)", fontWeight: 600,
                }}
              >
                <Icon size={16} style={{ flexShrink: 0, color: groupActive ? "var(--accent)" : "currentColor" }} />
                {!collapsed && (
                  <>
                    <span style={{ flex: 1, textAlign: "left" }}>{group.label}</span>
                    <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                      <ChevronDown size={13} />
                    </motion.span>
                  </>
                )}
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: "hidden", marginLeft: 12, borderLeft: "1px solid var(--line)", paddingLeft: 8 }}
                  >
                    {group.children.map((child) => (
                      <SubLink key={child.path} to={child.path} label={child.label} pathname={pathname} />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function SideLink({ to, icon: Icon, label, collapsed, pathname, groupPaths }) {
  const active = groupPaths
    ? groupPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))
    : pathname === to || pathname.startsWith(to + "/");
  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      style={{
        position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
        borderRadius: "var(--r-sm)", textDecoration: "none", fontSize: "var(--fs-13)", fontWeight: 600,
        color: active ? "var(--accent-ink)" : "var(--text-2)",
      }}
    >
      {active && (
        <motion.span
          layoutId="side-active"
          transition={{ type: "spring", stiffness: 520, damping: 36 }}
          style={{ position: "absolute", inset: 0, background: "var(--accent-soft)", borderRadius: "var(--r-sm)", zIndex: 0 }}
        />
      )}
      <Icon size={16} style={{ position: "relative", zIndex: 1, flexShrink: 0, color: active ? "var(--accent)" : "currentColor" }} />
      {!collapsed && <span style={{ position: "relative", zIndex: 1 }}>{label}</span>}
    </NavLink>
  );
}

function SubLink({ to, label, pathname }) {
  const active = pathname === to;
  return (
    <NavLink
      to={to}
      style={{
        display: "block", padding: "6px 10px", borderRadius: "var(--r-xs)", textDecoration: "none",
        fontSize: "var(--fs-12)", fontWeight: active ? 600 : 500,
        color: active ? "var(--accent)" : "var(--text-2)",
        background: active ? "var(--accent-soft)" : "transparent",
      }}
    >
      {label}
    </NavLink>
  );
}
