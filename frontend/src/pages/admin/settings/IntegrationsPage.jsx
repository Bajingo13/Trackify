import { Map, Mail, MessageSquare, Webhook, HardDrive, Calculator } from "lucide-react";
import { Card, Button } from "../../../components/ui";
import { SettingsPage } from "../../../components/settings";

const INTEGRATIONS = [
  { key: "maps", name: "Maps provider", icon: Map, description: "Base map tiles and geocoding for live tracking." },
  { key: "email", name: "Email / SMTP", icon: Mail, description: "Outbound notifications, invoices, and reports." },
  { key: "sms", name: "SMS gateway", icon: MessageSquare, description: "Driver and dispatch alerts over text message." },
  { key: "webhooks", name: "Webhooks", icon: Webhook, description: "Push trip and exception events to your systems." },
  { key: "storage", name: "File storage", icon: HardDrive, description: "Where proof-of-delivery photos and documents live." },
  { key: "accounting", name: "Accounting export", icon: Calculator, description: "Sync journal entries to your accounting package." },
];

function IntegrationCard({ name, description, icon: Icon }) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: "var(--s-3)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--s-3)" }}>
        <span
          style={{
            width: 38, height: 38, borderRadius: "var(--r-sm)", flexShrink: 0,
            background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center",
          }}
        >
          <Icon size={18} />
        </span>
        <span
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px",
            borderRadius: "var(--r-pill)", fontSize: "var(--fs-11)", fontWeight: 600,
            color: "var(--text-3)", background: "var(--surface-sunk)", border: "1px solid var(--line)",
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-3)" }} />
          Not connected
        </span>
      </div>
      <div>
        <div style={{ fontSize: "var(--fs-13)", fontWeight: 700, color: "var(--text)" }}>{name}</div>
        <p style={{ margin: "3px 0 0", fontSize: "var(--fs-12)", color: "var(--text-2)", lineHeight: 1.5 }}>{description}</p>
      </div>
      <div style={{ marginTop: "auto", paddingTop: "var(--s-2)" }}>
        <Button variant="secondary" size="sm" disabled>Configure</Button>
      </div>
    </Card>
  );
}

export default function IntegrationsPage() {
  return (
    <SettingsPage
      eyebrow="System"
      title="Integrations"
      description="Connect Trackify to the tools your team already uses."
    >
      <div
        style={{
          display: "grid", gap: "var(--s-4)",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        }}
      >
        {/* `key` is lifted out of the spread — React ignores a key arriving
            inside one, and warns about it on every render. */}
        {INTEGRATIONS.map(({ key, ...card }) => (
          <IntegrationCard key={key} {...card} />
        ))}
      </div>
      <p style={{ margin: "var(--s-4) 0 0", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
        Connecting integrations isn't available yet — this is a preview of what's planned.
      </p>
    </SettingsPage>
  );
}
