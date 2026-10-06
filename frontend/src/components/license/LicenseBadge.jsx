import { LICENSE_STATES } from "./licenseDisplay";

/** The status as a pill. The tooltip says what the word means, for anyone unsure. */
export default function LicenseBadge({ state, size = "md" }) {
  const { label, hint, color, bg } = LICENSE_STATES[state] || LICENSE_STATES.missing;
  const small = size === "sm";
  return (
    <span
      data-license-state={state}
      title={hint}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: small ? "2px 8px" : "3px 10px",
        fontSize: small ? "var(--fs-11)" : "var(--fs-12)", fontWeight: 600, lineHeight: 1.4,
        color, background: bg, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
        borderRadius: "var(--r-pill)", whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}
