import { useEffect, useState } from "react";
import {
  Map, Mail, MessageSquare, Webhook, HardDrive, Calculator, CheckCircle2, AlertTriangle, Minus,
} from "lucide-react";
import { Card } from "../../../components/ui";
import { SettingsPage } from "../../../components/settings";
import { useToast } from "../../../components/shared/Toast";
import { getIntegrations } from "../../../services/admin/settingsService";

/**
 * What is actually connected.
 *
 * This page used to list six services as cards with Connect buttons, over a
 * line admitting that connecting anything was not available yet. Two of the
 * six are genuinely wired — the address search and the file store — and their
 * state is worth knowing: whether uploads land on a disk that survives a
 * redeploy is the difference between having proof of delivery after the next
 * deploy and not having it.
 *
 * So the state comes from the running server, and the four that do not exist
 * say plainly what that means for the people using the system, rather than
 * being dressed up as coming soon.
 */

const ICONS = {
  maps: Map,
  storage: HardDrive,
  email: Mail,
  sms: MessageSquare,
  webhooks: Webhook,
  accounting: Calculator,
};

const STATES = {
  connected: { label: "Connected", icon: CheckCircle2, fg: "var(--ok)", bg: "var(--ok-soft)", line: "var(--ok-line)" },
  attention: { label: "Needs attention", icon: AlertTriangle, fg: "var(--warn)", bg: "var(--warn-soft)", line: "var(--warn-line)" },
  problem: { label: "Not working", icon: AlertTriangle, fg: "var(--danger)", bg: "var(--danger-soft)", line: "var(--danger-line)" },
  absent: { label: "Not set up", icon: Minus, fg: "var(--text-3)", bg: "var(--surface-sunk)", line: "var(--line)" },
};

function StateBadge({ state }) {
  const s = STATES[state] || STATES.absent;
  const Icon = s.icon;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
        padding: "3px 9px", borderRadius: "var(--r-pill)",
        fontSize: "var(--fs-11)", fontWeight: 600,
        color: s.fg, background: s.bg, border: `1px solid ${s.line}`,
      }}
    >
      <Icon size={11} />
      {s.label}
    </span>
  );
}

function IntegrationRow({ item, last }) {
  const Icon = ICONS[item.key] || HardDrive;
  const dimmed = item.state === "absent";

  return (
    <div
      style={{
        display: "flex", alignItems: "flex-start", gap: "var(--s-4)",
        padding: "var(--s-4) 0",
        borderBottom: last ? "none" : "1px solid var(--line-soft)",
        opacity: dimmed ? 0.72 : 1,
      }}
    >
      <span
        style={{
          width: 34, height: 34, flexShrink: 0, borderRadius: "var(--r-sm)",
          display: "grid", placeItems: "center",
          background: "var(--surface-sunk)", border: "1px solid var(--line)",
          color: "var(--text-2)",
        }}
      >
        <Icon size={16} />
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: "var(--fs-13)", fontWeight: 700, color: "var(--text)" }}>{item.name}</span>
          <StateBadge state={item.state} />
        </div>
        <div style={{ fontSize: "var(--fs-12)", color: "var(--text-2)", marginTop: 3 }}>{item.summary}</div>
        <div style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", marginTop: 3, lineHeight: 1.5 }}>
          {item.detail}
        </div>
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  const { addToast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getIntegrations()
      .then((data) => {
        if (!cancelled) setItems(data || []);
      })
      .catch((error) => {
        if (!cancelled) addToast(error.message || "Could not read the integration status.", "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [addToast]);

  /* Build-time settings, so they are read here rather than asked of the API. */
  const tiles = import.meta.env.VITE_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const usingDefaultTiles = tiles.includes("tile.openstreetmap.org");

  return (
    <SettingsPage
      eyebrow="System"
      title="Integrations"
      description="What this system is connected to, and what it is not."
    >
      <Card>
        {loading ? (
          <div style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", padding: "var(--s-3) 0" }}>
            Checking…
          </div>
        ) : (
          items.map((item, i) => (
            <IntegrationRow key={item.key} item={item} last={i === items.length - 1} />
          ))
        )}
      </Card>

      <p style={{ margin: "var(--s-3) 0 0", fontSize: "var(--fs-12)", color: "var(--text-3)", lineHeight: 1.6 }}>
        Map tiles come from{" "}
        {usingDefaultTiles
          ? "the public OpenStreetMap tile server, which asks for light use and has no uptime guarantee. Set VITE_MAP_TILE_URL to your own tile provider before heavy production use."
          : "your configured tile provider."}{" "}
        These settings are part of how the server is deployed, so changing one means changing the
        environment and restarting — there is nothing here to switch on from this page.
      </p>
    </SettingsPage>
  );
}
