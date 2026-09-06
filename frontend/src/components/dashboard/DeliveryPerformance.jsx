import { CheckCircle2, Timer } from "lucide-react";

/**
 * Both figures come from the trips the dashboard already loaded:
 *   onTimePct — closed trips that arrived on or before their scheduled arrival
 *   completed — trips in operationally_closed
 * When nothing has closed yet there is no percentage to show, so the panel
 * says so rather than reporting a 0% that would read as poor performance.
 */
export default function DeliveryPerformance({ onTimePct = null, completed = 0 }) {
  const hasOnTime = onTimePct != null;

  return (
    <div className="card p-5 flex flex-col gap-3">
      <span className="font-semibold text-base" style={{ color: "var(--trackify-text)" }}>
        Delivery Performance
      </span>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Timer size={14} style={{ color: "var(--text-3)" }} />
            <span className="text-xs font-medium" style={{ color: "var(--trackify-text-secondary)" }}>
              On-Time Delivery
            </span>
          </div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--trackify-text)", fontVariantNumeric: "tabular-nums" }}
          >
            {hasOnTime ? `${onTimePct}%` : "—"}
          </div>
          <div className="text-[11px]" style={{ color: "var(--trackify-text-muted)" }}>
            {hasOnTime ? "of closed trips arrived on schedule" : "no closed trips to measure yet"}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} style={{ color: "var(--text-3)" }} />
            <span className="text-xs font-medium" style={{ color: "var(--trackify-text-secondary)" }}>
              Completed Trips
            </span>
          </div>
          <div
            className="text-2xl font-bold"
            style={{ color: "var(--trackify-text)", fontVariantNumeric: "tabular-nums" }}
          >
            {completed ?? 0}
          </div>
          <div className="text-[11px]" style={{ color: "var(--trackify-text-muted)" }}>
            operationally closed
          </div>
        </div>
      </div>

      {hasOnTime && (
        <div>
          <div className="flex items-center justify-between text-[11px] mb-1" style={{ color: "var(--trackify-text-muted)" }}>
            <span>On-time rate</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{onTimePct}%</span>
          </div>
          <div className="ops-progress-bar" style={{ width: "100%", height: 6, borderRadius: 3, overflow: "hidden", background: "var(--surface-sunk)" }}>
            <div
              style={{
                width: `${Math.min(100, Math.max(0, onTimePct))}%`,
                height: "100%",
                background: onTimePct >= 90 ? "var(--ok)" : onTimePct >= 70 ? "var(--warn)" : "var(--danger)",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
