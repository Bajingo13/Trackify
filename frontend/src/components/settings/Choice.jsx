/**
 * A labelled segmented single-select for settings forms. Plain buttons (no
 * shared layout animation), so several can sit on one screen without fighting
 * over an animated pill.
 */
export default function Choice({ label, hint, value, options, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
      {label && (
        <span style={{ fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--text-2)" }}>{label}</span>
      )}
      <div
        role="radiogroup"
        aria-label={label}
        style={{
          display: "inline-flex", gap: 2, padding: 3, background: "var(--surface-sunk)",
          borderRadius: "var(--r-sm)", border: "1px solid var(--line)",
        }}
      >
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              style={{
                padding: "5px 12px", fontSize: "var(--fs-12)", fontWeight: 600, border: "none", cursor: "pointer",
                borderRadius: "var(--r-xs)",
                background: active ? "var(--surface)" : "transparent",
                color: active ? "var(--text)" : "var(--text-2)",
                boxShadow: active ? "var(--shadow-1)" : "none",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {hint && <span style={{ fontSize: "var(--fs-11)", color: "var(--text-3)" }}>{hint}</span>}
    </div>
  );
}
