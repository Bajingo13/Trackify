import { Route, Navigation, Clock, AlertTriangle } from "lucide-react";
import { CountUp } from "../ui";

const ICONS = {
  tripsToday: Route,
  inTransit: Navigation,
  forApproval: Clock,
  exceptions: AlertTriangle,
};

/**
 * One strip carrying the four headline counts, divided rather than boxed.
 * No period-over-period deltas: nothing in the API reports a previous
 * period, and a comparison we cannot compute is not one worth inventing.
 */
export default function KpiStrip({ cards = [] }) {
  const items = cards.length ? cards : Array.from({ length: 4 }, (_, i) => ({ id: i }));

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="tk-kpi-strip">
        {items.map((c, i) => {
          const Icon = ICONS[c.id];
          return (
            <div key={c.id ?? i} className="tk-kpi-cell">
              <span className="tk-kpi-glyph" aria-hidden="true">
                {Icon ? <Icon size={16} /> : null}
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="tk-kpi-figure">
                  <CountUp value={Number(c.value) || 0} />
                </div>
                <div className="tk-kpi-label">{c.label || "—"}</div>
                {c.changeLabel && <div className="tk-kpi-sub">{c.changeLabel}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
