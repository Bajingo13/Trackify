import { useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { usePermissions } from "../../auth/permissions";
import useMediaQuery from "../../hooks/useMediaQuery";
import { filterSettingsNav } from "../../pages/admin/settings/settingsNav";

/**
 * The persistent Settings rail. Groups (Account / Organization / User Management
 * / System) are permission-filtered; the active item is highlighted with a
 * shared layout pill. Below 900px it collapses to a horizontal, scrollable chip
 * row that sits above the routed content.
 */
export default function SettingsSidebar() {
  const { can } = usePermissions();
  const { pathname } = useLocation();
  const groups = useMemo(() => filterSettingsNav(can), [can]);
  const compact = useMediaQuery("(max-width: 900px)");

  const isActive = (path) => pathname === path || pathname.startsWith(path + "/");

  if (compact) {
    return (
      <div
        role="tablist"
        aria-label="Settings sections"
        style={{
          display: "flex", gap: 6, overflowX: "auto", padding: "var(--s-3) var(--s-4)",
          borderBottom: "1px solid var(--line)", background: "var(--surface-2)",
          scrollbarWidth: "none",
        }}
      >
        {groups.flatMap((g) => g.items).map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              role="tab"
              aria-selected={active}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7, flexShrink: 0,
                padding: "7px 12px", borderRadius: "var(--r-pill)", textDecoration: "none",
                fontSize: "var(--fs-12)", fontWeight: 600, whiteSpace: "nowrap",
                border: "1px solid var(--line)",
                color: active ? "var(--accent-ink)" : "var(--text-2)",
                background: active ? "var(--accent-soft)" : "var(--surface)",
              }}
            >
              <Icon size={14} style={{ color: active ? "var(--accent)" : "currentColor" }} />
              {item.label}
            </NavLink>
          );
        })}
      </div>
    );
  }

  return (
    <nav
      aria-label="Settings sections"
      style={{
        width: 248, flexShrink: 0, borderRight: "1px solid var(--line)",
        background: "var(--surface-2)", padding: "var(--s-4) var(--s-3)",
        display: "flex", flexDirection: "column", gap: "var(--s-4)",
      }}
    >
      {groups.map((group) => (
        <div key={group.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div
            style={{
              fontFamily: "var(--font-pixel)", fontSize: 10, letterSpacing: "1.4px",
              textTransform: "uppercase", color: "var(--text-3)", padding: "4px 10px 6px",
            }}
          >
            {group.label}
          </div>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <NavLink
                key={item.path}
                to={item.path}
                style={{
                  position: "relative", display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: "var(--r-sm)", textDecoration: "none",
                  fontSize: "var(--fs-13)", fontWeight: 600,
                  color: active ? "var(--accent-ink)" : "var(--text-2)",
                }}
              >
                {active && (
                  <motion.span
                    layoutId="settings-rail-active"
                    transition={{ type: "spring", stiffness: 520, damping: 36 }}
                    style={{ position: "absolute", inset: 0, background: "var(--accent-soft)", borderRadius: "var(--r-sm)", zIndex: 0 }}
                  />
                )}
                <Icon
                  size={16}
                  style={{ position: "relative", zIndex: 1, flexShrink: 0, color: active ? "var(--accent)" : "currentColor" }}
                />
                <span style={{ position: "relative", zIndex: 1 }}>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
