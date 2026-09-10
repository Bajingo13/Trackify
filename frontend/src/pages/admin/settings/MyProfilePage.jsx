import { User, Mail, ShieldCheck, Building2, MapPin, Camera } from "lucide-react";
import { Card } from "../../../components/ui";
import { SettingsPage } from "../../../components/settings";
import { useToast } from "../../../components/shared/Toast";
import { useAuth } from "../../../context/AuthContext";
import useMediaQuery from "../../../hooks/useMediaQuery";

function Pill({ children }) {
  return (
    <span
      style={{
        padding: "3px 10px", borderRadius: "var(--r-pill)", fontSize: "var(--fs-11)", fontWeight: 600,
        background: "var(--accent-soft)", color: "var(--accent-ink)", border: "1px solid var(--line)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function ProfileRow({ icon: Icon, label, value, children, last }) {
  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: "minmax(120px, 160px) 1fr", gap: "var(--s-4)",
        alignItems: "center", padding: "12px 0",
        borderBottom: last ? "none" : "1px solid var(--line-soft)",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--text-3)" }}>
        <Icon size={14} style={{ flexShrink: 0 }} />
        {label}
      </span>
      <span style={{ fontSize: "var(--fs-13)", color: "var(--text)", minWidth: 0 }}>{children ?? value}</span>
    </div>
  );
}

export default function MyProfilePage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const stacked = useMediaQuery("(max-width: 820px)");

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "—";
  const email = user?.email || "—";
  const roles = (user?.roles || []).map((r) => r.role_name).filter(Boolean);
  const access = user?.access?.[0];
  const initial = user?.firstName?.[0]?.toUpperCase() || "U";

  const rolePills = roles.length ? (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6 }}>
      {roles.map((r) => <Pill key={r}>{r}</Pill>)}
    </span>
  ) : "—";

  return (
    <SettingsPage
      eyebrow="Account"
      title="My Profile"
      description="Your account details and where you have access."
    >
      <Card pad="0" style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {/* identity */}
          <div
            style={{
              flex: "0 1 360px", minWidth: 260, display: "flex", alignItems: "center", gap: "var(--s-4)",
              padding: "var(--s-6)",
            }}
          >
            <div style={{ position: "relative", flexShrink: 0 }}>
              <span
                style={{
                  width: 88, height: 88, borderRadius: "50%", display: "grid", placeItems: "center",
                  background: "linear-gradient(135deg, var(--brand-blue), var(--brand-navy))",
                  color: "#fff", fontSize: "var(--fs-26)", fontWeight: 700,
                }}
              >
                {initial}
              </span>
              <button
                type="button"
                aria-label="Change photo"
                title="Photo upload isn't available yet"
                onClick={() => addToast("Photo upload isn't available yet.", "info")}
                style={{
                  position: "absolute", right: -2, bottom: -2, width: 28, height: 28, borderRadius: "50%",
                  background: "var(--accent)", color: "var(--text-on-accent)", border: "3px solid var(--surface)",
                  display: "grid", placeItems: "center", cursor: "pointer",
                }}
              >
                <Camera size={13} />
              </button>
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "var(--fs-18)", fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>
                {fullName}
              </div>
              <div style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", margin: "2px 0 8px", overflowWrap: "anywhere" }}>
                {email}
              </div>
              {rolePills}
            </div>
          </div>

          {/* details */}
          <div
            style={{
              flex: "1 1 380px", minWidth: 300, padding: "var(--s-5) var(--s-6)",
              borderLeft: stacked ? "none" : "1px solid var(--line)",
              borderTop: stacked ? "1px solid var(--line)" : "none",
            }}
          >
            <ProfileRow icon={User} label="Full name" value={fullName} />
            <ProfileRow icon={Mail} label="Email" value={email} />
            <ProfileRow icon={ShieldCheck} label="Role">{rolePills}</ProfileRow>
            <ProfileRow icon={Building2} label="Company" value={access?.company_name || "—"} />
            <ProfileRow icon={MapPin} label="Branch" value={access?.branch_name || "—"} last />
          </div>
        </div>
      </Card>

      <p style={{ margin: "var(--s-3) 0 0", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
        Profile editing isn't available yet. Ask an administrator to update your name, email, or roles.
      </p>
    </SettingsPage>
  );
}
