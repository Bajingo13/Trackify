import { useEffect, useState } from "react";
import { AlertTriangle, AlertCircle, PackageX, Info, CheckCircle2 } from "lucide-react";
import { getLowStock } from "../../services/warehouse/inventoryService";
import { getAllExceptions } from "../../services/operations/exceptionService";

const severityConfig = {
  warning: { icon: AlertTriangle, color: "#D4A017" },
  critical: { icon: AlertCircle, color: "#C53030" },
  info: { icon: Info, color: "#2455D6" },
};

/** Build a flat, severity-sorted alert list from whatever the user can see. */
async function loadAlerts() {
  const out = [];

  const [low, exc] = await Promise.allSettled([getLowStock(), getAllExceptions()]);

  if (low.status === "fulfilled") {
    for (const s of low.value) {
      out.push({
        id: `low-${s.stockId}`,
        severity: s.severity,
        icon: s.quantity <= 0 ? PackageX : AlertTriangle,
        title: s.quantity <= 0 ? `${s.name} out of stock` : `${s.name} low`,
        description: `${s.locationName} — ${s.quantity} ${s.unit || ""} on hand (reorder at ${s.reorderLevel})`,
        tag: "Inventory",
      });
    }
  }

  if (exc.status === "fulfilled") {
    const openExc = exc.value.filter((e) => e.status && e.status !== "resolved").slice(0, 8);
    for (const e of openExc) {
      const sev = ["high", "critical"].includes(e.severity) ? "critical" : "warning";
      out.push({
        id: `exc-${e.id}`,
        severity: sev,
        icon: AlertCircle,
        title: e.title || e.type || "Operational exception",
        description: [e.tripTicket, e.description].filter(Boolean).join(" — "),
        tag: "Operations",
      });
    }
  }

  const rank = { critical: 0, warning: 1, info: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return out;
}

export default function OperationalAlerts() {
  const [alerts, setAlerts] = useState(null);

  useEffect(() => {
    let live = true;
    loadAlerts().then((a) => { if (live) setAlerts(a); }).catch(() => { if (live) setAlerts([]); });
    return () => { live = false; };
  }, []);

  return (
    <div className="card p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-base" style={{ color: "var(--trackify-text)" }}>Operational Alerts</span>
        {alerts?.length ? (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(197,48,48,0.1)", color: "#C53030" }}>
            {alerts.length}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-2.5">
        {alerts === null && (
          <div className="text-xs" style={{ color: "var(--trackify-text-muted)" }}>Loading…</div>
        )}

        {alerts?.length === 0 && (
          <div className="flex items-center gap-2 py-4 text-sm" style={{ color: "var(--trackify-text-secondary)" }}>
            <CheckCircle2 size={16} style={{ color: "#15803D" }} />
            Nothing needs attention right now.
          </div>
        )}

        {(alerts || []).slice(0, 6).map((alert) => {
          const sev = severityConfig[alert.severity] || severityConfig.info;
          const Icon = alert.icon || sev.icon;
          return (
            <div
              key={alert.id}
              className="flex items-start gap-3 p-3 rounded-xl"
              style={{ background: `${sev.color}0F`, border: `1px solid ${sev.color}20` }}
            >
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${sev.color}18` }}>
                <Icon size={14} style={{ color: sev.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold" style={{ color: "var(--trackify-text)" }}>{alert.title}</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: `${sev.color}14`, color: sev.color }}>
                    {alert.tag}
                  </span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--trackify-text-secondary)" }}>{alert.description}</div>
              </div>
            </div>
          );
        })}

        {alerts && alerts.length > 6 && (
          <div className="text-[11px] pt-1" style={{ color: "var(--trackify-text-muted)" }}>
            +{alerts.length - 6} more
          </div>
        )}
      </div>
    </div>
  );
}
