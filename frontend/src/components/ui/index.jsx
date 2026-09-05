import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, animate } from "motion/react";
import { fadeUp } from "../../motion";

export { default as Button } from "./Button";
export { default as DataTable } from "./DataTable";
export { Modal, Drawer } from "./Overlay";

/* ---------------- Card ---------------- */
export function Card({ children, pad = "var(--s-5)", style, as = "div", hover = false, ...rest }) {
  const Comp = hover ? motion.div : as;
  return (
    <Comp
      {...(hover ? { whileHover: { y: -2, boxShadow: "var(--shadow-3)" }, transition: { duration: 0.18 } } : {})}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-2)",
        padding: pad,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Comp>
  );
}

/* ---------------- PageHeader ---------------- */
export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="show"
      style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--s-4)", marginBottom: "var(--s-5)", flexWrap: "wrap" }}
    >
      <div>
        {eyebrow && (
          <div style={{ fontFamily: "var(--font-pixel)", fontSize: "10px", letterSpacing: "1.6px", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 7 }}>
            {eyebrow}
          </div>
        )}
        <h1 style={{ margin: 0, fontSize: "var(--fs-21)", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)" }}>{title}</h1>
        {subtitle && <p style={{ margin: "4px 0 0", fontSize: "var(--fs-13)", color: "var(--text-2)" }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: "flex", gap: "var(--s-2)", alignItems: "center", flexShrink: 0 }}>{actions}</div>}
    </motion.div>
  );
}

/* ---------------- StatCard (count-up) ---------------- */
export function StatCard({ label, value, hint, tone = "neutral", icon: Icon, index = 0 }) {
  // `tone` is still accepted so no call site breaks, but KPI cards are
  // deliberately monochrome — the figure carries the card. Colour is kept
  // for interaction state and genuinely semantic signals elsewhere.
  void tone;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -1, boxShadow: "var(--shadow-2)" }}
      transition={{ duration: 0.3, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: "relative",
        background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-md)",
        padding: "var(--s-4)", display: "flex", flexDirection: "column", gap: 2,
        boxShadow: "var(--shadow-1)",
      }}
    >
      {Icon && (
        <span aria-hidden="true" style={{ position: "absolute", top: "var(--s-4)", right: "var(--s-4)", color: "var(--text-3)", display: "inline-flex" }}>
          <Icon size={15} />
        </span>
      )}
      <span style={{ fontSize: "var(--fs-11)", fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".06em", paddingRight: 22, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </span>
      <span className="tk-statnum" style={{ fontSize: "var(--fs-32)", fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em", color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        <CountUp value={Number(value) || 0} />
      </span>
      {hint && <span style={{ fontSize: "var(--fs-11)", color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hint}</span>}
    </motion.div>
  );
}

export function CountUp({ value, duration = 0.7 }) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const controls = animate(prev.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, duration]);
  return <>{display.toLocaleString()}</>;
}

/* ---------------- StatusPill (animated on change) ---------------- */
const STATUS_STYLE = {
  draft: ["var(--st-draft)", "color-mix(in srgb, var(--st-draft) 14%, transparent)"],
  for_validation: ["var(--st-review)", "var(--warn-soft)"],
  for_approval: ["var(--st-review)", "var(--warn-soft)"],
  validated: ["var(--st-approved)", "color-mix(in srgb, var(--st-approved) 14%, transparent)"],
  approved: ["var(--st-approved)", "color-mix(in srgb, var(--st-approved) 14%, transparent)"],
  assigned: ["var(--st-active)", "var(--accent-soft)"],
  accepted: ["var(--st-active)", "var(--accent-soft)"],
  released: ["var(--st-active)", "var(--accent-soft)"],
  in_transit: ["var(--st-transit)", "color-mix(in srgb, var(--st-transit) 14%, transparent)"],
  delivered: ["var(--st-done)", "var(--ok-soft)"],
  returned: ["var(--st-done)", "var(--ok-soft)"],
  operationally_closed: ["var(--st-done)", "var(--ok-soft)"],
  rejected: ["var(--st-stopped)", "var(--danger-soft)"],
  cancelled: ["var(--st-stopped)", "var(--danger-soft)"],
  active: ["var(--ok)", "var(--ok-soft)"],
  inactive: ["var(--text-3)", "var(--surface-sunk)"],
  // finance
  recorded: ["var(--st-draft)", "color-mix(in srgb, var(--st-draft) 14%, transparent)"],
  on_voucher: ["var(--st-review)", "var(--warn-soft)"],
  reimbursed: ["var(--st-done)", "var(--ok-soft)"],
  submitted: ["var(--st-review)", "var(--warn-soft)"],
  sent: ["var(--st-active)", "var(--accent-soft)"],
  partial: ["var(--st-transit)", "color-mix(in srgb, var(--st-transit) 14%, transparent)"],
  paid: ["var(--st-done)", "var(--ok-soft)"],
  posted: ["var(--st-done)", "var(--ok-soft)"],
  void: ["var(--st-stopped)", "var(--danger-soft)"],
  filed: ["var(--st-done)", "var(--ok-soft)"],
};

export function StatusPill({ status, size = "md" }) {
  const key = String(status || "").toLowerCase();
  const [fg, bg] = STATUS_STYLE[key] || ["var(--text-2)", "var(--surface-sunk)"];
  const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <motion.span
      key={key}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: size === "sm" ? "2px 8px" : "3px 10px",
        fontSize: size === "sm" ? "var(--fs-11)" : "var(--fs-12)", fontWeight: 600,
        color: fg, background: bg, border: `1px solid color-mix(in srgb, ${fg} 30%, transparent)`,
        borderRadius: "var(--r-pill)", whiteSpace: "nowrap", lineHeight: 1.4,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: fg }} />
      {label}
    </motion.span>
  );
}

/* ---------------- EmptyState ---------------- */
export function EmptyState({ icon: Icon, title, hint }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "var(--s-12) var(--s-4)", textAlign: "center" }}
    >
      {Icon && (
        <span style={{ width: 44, height: 44, borderRadius: "var(--r-md)", background: "var(--surface-sunk)", color: "var(--text-3)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={20} />
        </span>
      )}
      <div style={{ fontSize: "var(--fs-14)", fontWeight: 600, color: "var(--text)" }}>{title}</div>
      {hint && <div style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", maxWidth: 320 }}>{hint}</div>}
    </motion.div>
  );
}

/* ---------------- Field ---------------- */
export function Field({ label, hint, required, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--text-2)" }}>
        {label} {required && <span style={{ color: "var(--danger)" }}>*</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: "var(--fs-11)", color: "var(--text-3)" }}>{hint}</span>}
    </label>
  );
}

export const inputStyle = {
  width: "100%", padding: "8px 11px", fontSize: "var(--fs-13)", fontFamily: "var(--font-sans)",
  color: "var(--text)", background: "var(--surface-2)", border: "1px solid var(--line-strong)",
  borderRadius: "var(--r-sm)", outlineOffset: 1,
};

/* ---------------- Segmented (filter tabs) ---------------- */
export function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "inline-flex", gap: 2, padding: 3, background: "var(--surface-sunk)", borderRadius: "var(--r-sm)", border: "1px solid var(--line)" }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{ position: "relative", padding: "5px 11px", fontSize: "var(--fs-12)", fontWeight: 600, border: "none", background: "transparent", cursor: "pointer", color: active ? "var(--text)" : "var(--text-2)", borderRadius: "var(--r-xs)" }}
          >
            {active && (
              <motion.span
                layoutId="seg-active"
                transition={{ type: "spring", stiffness: 500, damping: 34 }}
                style={{ position: "absolute", inset: 0, background: "var(--surface)", borderRadius: "var(--r-xs)", boxShadow: "var(--shadow-1)", zIndex: 0 }}
              />
            )}
            <span style={{ position: "relative", zIndex: 1 }}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* re-export the spring for callers that need it */
export { useMotionValue, useSpring };
