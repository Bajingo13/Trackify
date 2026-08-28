import { AlertTriangle, AlertCircle, Info, Clock } from "lucide-react";
import { operationalAlerts } from "../../data/dashboardData";

const severityConfig = {
  warning: {
    icon: AlertTriangle,
    color: "#D4A017",
    bg: "rgba(212,160,23,0.06)",
    border: "rgba(212,160,23,0.12)",
    label: "Warning",
  },
  critical: {
    icon: AlertCircle,
    color: "#C53030",
    bg: "rgba(197,48,48,0.06)",
    border: "rgba(197,48,48,0.12)",
    label: "Critical",
  },
  info: {
    icon: Info,
    color: "#2455D6",
    bg: "rgba(36,85,214,0.06)",
    border: "rgba(36,85,214,0.12)",
    label: "Info",
  },
};

export default function OperationalAlerts() {
  return (
    <div className="card p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-base" style={{ color: "var(--trackify-text)" }}>Operational Alerts</span>
        <button className="text-xs font-semibold transition-opacity hover:opacity-70" style={{ color: "var(--trackify-blue)" }}>
          View all
        </button>
      </div>

      <div className="flex flex-col gap-2.5">
        {operationalAlerts.map((alert) => {
          const sev = severityConfig[alert.severity];
          const Icon = sev.icon;
          return (
            <div
              key={alert.id}
              className="flex items-start gap-3 p-3 rounded-xl transition-colors cursor-pointer group"
              style={{ background: sev.bg, border: `1px solid ${sev.border}` }}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: `${sev.color}15` }}
              >
                <Icon size={14} style={{ color: sev.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: "var(--trackify-text)" }}>{alert.title}</span>
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: `${sev.color}12`, color: sev.color }}
                  >
                    {sev.label}
                  </span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--trackify-text-secondary)" }}>{alert.description}</div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0 text-[11px]" style={{ color: "var(--trackify-text-muted)" }}>
                <Clock size={10} />
                {alert.time}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
