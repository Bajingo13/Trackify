import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { usePermissions } from "../../../auth/permissions";
import { fadeUp, stagger, staggerItem } from "../../../motion";
import { filterSettingsNav } from "./settingsNav";

export default function SettingsOverview() {
  const { can } = usePermissions();
  const navigate = useNavigate();
  const groups = useMemo(() => filterSettingsNav(can), [can]);

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show">
      <div
        style={{
          fontFamily: "var(--font-pixel)", fontSize: 10, letterSpacing: "1.6px",
          textTransform: "uppercase", color: "var(--text-3)", marginBottom: 7,
        }}
      >
        Settings
      </div>
      <h2 style={{ margin: 0, fontSize: "var(--fs-18)", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)" }}>
        Settings overview
      </h2>
      <p style={{ margin: "4px 0 var(--s-6)", fontSize: "var(--fs-13)", color: "var(--text-2)" }}>
        Manage your account and access authorized administrative configuration from one place.
      </p>

      <div
        style={{
          display: "grid", gap: "var(--s-6) var(--s-8)",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        }}
      >
        {groups.map((group) => (
          <section key={group.label}>
            <h3 style={{ margin: "0 0 var(--s-3)", fontSize: "var(--fs-13)", fontWeight: 700, color: "var(--text)" }}>
              {group.label}
            </h3>
            <motion.div variants={stagger()} initial="hidden" animate="show" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <motion.button
                    key={item.path}
                    variants={staggerItem}
                    onClick={() => navigate(item.path)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    style={{
                      display: "flex", alignItems: "center", gap: "var(--s-3)", width: "100%",
                      padding: "10px 12px", border: "none", borderRadius: "var(--r-md)",
                      background: "transparent", cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        width: 34, height: 34, borderRadius: "var(--r-sm)", flexShrink: 0,
                        background: "var(--accent-soft)", color: "var(--accent)",
                        display: "grid", placeItems: "center",
                      }}
                    >
                      <Icon size={16} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text)" }}>
                        {item.label}
                      </span>
                      <span style={{ display: "block", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
                        {item.kind === "account" ? "Personal account" : "Administrative access"}
                      </span>
                    </span>
                    <ChevronRight size={16} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                  </motion.button>
                );
              })}
            </motion.div>
          </section>
        ))}
      </div>
    </motion.div>
  );
}
