import { Card } from "../ui";

/**
 * A titled settings group. Header (title + optional description) sits above a
 * body of form controls, all inside the shared Card surface.
 */
export default function FormSection({ title, description, actions, children }) {
  return (
    <Card style={{ marginBottom: "var(--s-4)" }}>
      <div
        style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          gap: "var(--s-4)", marginBottom: "var(--s-4)",
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: "var(--fs-14)", fontWeight: 700, color: "var(--text)" }}>{title}</h3>
          {description && (
            <p style={{ margin: "3px 0 0", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>{description}</p>
          )}
        </div>
        {actions && <div style={{ flexShrink: 0 }}>{actions}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-4)" }}>{children}</div>
    </Card>
  );
}
