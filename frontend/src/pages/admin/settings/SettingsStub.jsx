import { Hammer } from "lucide-react";

/**
 * Placeholder panel for a Settings section that's wired into the nav but not
 * built yet. Sits inside the section's SettingsPage, so it carries no heading
 * of its own.
 */
export default function SettingsStub({ note }) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 10, padding: "var(--s-12) var(--s-4)", textAlign: "center",
        border: "1px dashed var(--line-strong)", borderRadius: "var(--r-lg)", background: "var(--surface-2)",
      }}
    >
      <span
        style={{
          width: 52, height: 52, borderRadius: "var(--r-lg)", background: "var(--accent-soft)",
          color: "var(--accent)", display: "grid", placeItems: "center",
        }}
      >
        <Hammer size={24} />
      </span>
      <div style={{ fontSize: "var(--fs-15)", fontWeight: 700, color: "var(--text)" }}>Coming soon</div>
      <p style={{ fontSize: "var(--fs-13)", color: "var(--text-2)", maxWidth: 360, margin: 0, lineHeight: 1.6 }}>
        {note || "This section is on the roadmap. It lives here so the right roles will find it the moment it ships."}
      </p>
    </div>
  );
}
