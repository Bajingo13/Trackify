import { motion } from "motion/react";
import { fadeUp } from "../../motion";

/**
 * Content-area wrapper for a Settings module. Mirrors the "Settings overview"
 * heading treatment (small pixel eyebrow, ~18px title, muted description) so
 * every section reads as the same screen, with an optional right-aligned
 * actions slot.
 */
export default function SettingsPage({ eyebrow, title, description, actions, children }) {
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show">
      <div
        style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          gap: "var(--s-4)", flexWrap: "wrap", marginBottom: "var(--s-5)",
        }}
      >
        <div>
          {eyebrow && (
            <div
              style={{
                fontFamily: "var(--font-pixel)", fontSize: 10, letterSpacing: "1.6px",
                textTransform: "uppercase", color: "var(--text-3)", marginBottom: 7,
              }}
            >
              {eyebrow}
            </div>
          )}
          <h2 style={{ margin: 0, fontSize: "var(--fs-18)", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)" }}>
            {title}
          </h2>
          {description && (
            <p style={{ margin: "4px 0 0", fontSize: "var(--fs-13)", color: "var(--text-2)" }}>{description}</p>
          )}
        </div>
        {actions && (
          <div style={{ display: "flex", gap: "var(--s-2)", alignItems: "center", flexShrink: 0 }}>{actions}</div>
        )}
      </div>
      {children}
    </motion.div>
  );
}
