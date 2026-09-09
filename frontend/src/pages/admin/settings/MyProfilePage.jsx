import { Card } from "../../../components/ui";
import { SettingsPage } from "../../../components/settings";
import { useAuth } from "../../../context/AuthContext";

function Row({ label, children }) {
  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: "180px 1fr", gap: "var(--s-4)",
        padding: "var(--s-4) 0", borderBottom: "1px solid var(--line-soft)",
      }}
    >
      <span style={{ fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--text-3)" }}>{label}</span>
      <span style={{ fontSize: "var(--fs-13)", color: "var(--text)" }}>{children}</span>
    </div>
  );
}

export default function MyProfilePage() {
  const { user } = useAuth();

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "—";
  const roles = (user?.roles || []).map((r) => r.role_name).filter(Boolean);
  const access = user?.access?.[0];

  return (
    <SettingsPage
      eyebrow="Account"
      title="My Profile"
      description="Your account details and where you have access."
    >
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s-4)", marginBottom: "var(--s-3)" }}>
          <span
            style={{
              width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
              background: "linear-gradient(135deg, var(--brand-blue), var(--brand-navy))",
              color: "#fff", display: "grid", placeItems: "center", fontSize: "var(--fs-16)", fontWeight: 700,
            }}
          >
            {user?.firstName?.[0]?.toUpperCase() || "U"}
          </span>
          <div>
            <div style={{ fontSize: "var(--fs-15)", fontWeight: 700, color: "var(--text)" }}>{fullName}</div>
            <div style={{ fontSize: "var(--fs-12)", color: "var(--text-3)" }}>{user?.email || "—"}</div>
          </div>
        </div>

        <Row label="Full name">{fullName}</Row>
        <Row label="Email">{user?.email || "—"}</Row>
        <Row label="Role">
          {roles.length ? (
            <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6 }}>
              {roles.map((r) => (
                <span
                  key={r}
                  style={{
                    padding: "2px 9px", borderRadius: "var(--r-pill)", fontSize: "var(--fs-11)", fontWeight: 600,
                    background: "var(--accent-soft)", color: "var(--accent-ink)", border: "1px solid var(--line)",
                  }}
                >
                  {r}
                </span>
              ))}
            </span>
          ) : "—"}
        </Row>
        <Row label="Company">{access?.company_name || "—"}</Row>
        <Row label="Branch">{access?.branch_name || "—"}</Row>
      </Card>

      <p style={{ margin: "var(--s-3) 0 0", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
        Profile editing isn't available yet. Ask an administrator to update your name, email, or roles.
      </p>
    </SettingsPage>
  );
}
