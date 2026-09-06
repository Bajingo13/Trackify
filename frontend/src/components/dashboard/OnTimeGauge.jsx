/**
 * Half-ring gauge for the on-time rate. The figure is the same one Delivery
 * Performance reports: closed trips that arrived on or before schedule.
 * With nothing closed there is no rate, and the gauge says so rather than
 * drawing an arc at zero that would read as total failure.
 */
export default function OnTimeGauge({ pct = null, closedCount = null }) {
  const has = pct != null;
  const value = has ? Math.max(0, Math.min(100, pct)) : 0;

  // half ring: radius 52, sweeping 180deg -> length = pi * r
  const R = 52;
  const LEN = Math.PI * R;
  // round caps add half a stroke width at each end, so the drawn length is
  // shortened by one full width to keep the arc honest about the percentage
  const CAP = 14;
  const dash = value === 0 ? 0 : Math.max(0.1, (value / 100) * LEN - CAP);

  return (
    <div className="card p-5 flex flex-col gap-2">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold text-base" style={{ color: "var(--trackify-text)" }}>
            On-Time Rate
          </div>
          <div className="text-[11px]" style={{ color: "var(--trackify-text-muted)" }}>
            Closed trips that met their schedule
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <svg viewBox="0 0 140 82" width="100%" style={{ maxWidth: 220 }} role="img"
             aria-label={has ? `${value}% on time` : "No completed trips yet"}>
          <path d="M18 70 A52 52 0 0 1 122 70" fill="none" stroke="var(--surface-sunk)" strokeWidth="14" strokeLinecap="round" />
          {has && (
            <path
              d="M18 70 A52 52 0 0 1 122 70"
              fill="none"
              stroke="var(--text)"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${LEN}`}
            />
          )}
          <text x="70" y="63" textAnchor="middle"
                style={{ fontSize: 26, fontWeight: 700, fill: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
            {has ? `${value}%` : "—"}
          </text>
        </svg>
      </div>

      <div className="text-[11px] text-center" style={{ color: "var(--trackify-text-muted)" }}>
        {has
          ? closedCount != null
            ? `across ${closedCount} completed ${closedCount === 1 ? "trip" : "trips"}`
            : "of completed trips"
          : "no completed trips to measure yet"}
      </div>
    </div>
  );
}
