/**
 * Filter/search bar above a Settings table. Left slot holds search + filters,
 * right slot holds secondary actions. Wraps on narrow screens.
 */
export default function SettingsToolbar({ children, right }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "var(--s-3)", flexWrap: "wrap", marginBottom: "var(--s-4)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)", flexWrap: "wrap", flex: 1, minWidth: 0 }}>
        {children}
      </div>
      {right && <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)", flexShrink: 0 }}>{right}</div>}
    </div>
  );
}
