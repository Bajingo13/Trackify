import { useNavigate } from "react-router-dom";
import { MapPin, User, Truck } from "lucide-react";

function fmt(at) {
  if (!at) return "—";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * The one run worth watching, with its real milestones. A step that has not
 * happened yet is labelled "planned" against its scheduled time rather than
 * being drawn as if it had already completed.
 */
export default function TripProgress({ trip }) {
  const navigate = useNavigate();

  if (!trip) {
    return (
      <div className="card p-5 flex flex-col gap-3">
        <span className="font-semibold text-base" style={{ color: "var(--trackify-text)" }}>
          Trip Progress
        </span>
        <div className="text-sm py-6 text-center" style={{ color: "var(--trackify-text-secondary)" }}>
          No trip is on the road or due out right now.
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div style={{ minWidth: 0 }}>
          <span className="font-semibold text-base" style={{ color: "var(--trackify-text)" }}>
            Trip Progress
          </span>
          <div
            className="text-[11px] mt-0.5"
            style={{ color: "var(--trackify-text-muted)", fontVariantNumeric: "tabular-nums" }}
          >
            {trip.ticketNo}
          </div>
        </div>
        <span className="tk-chip" style={{ flexShrink: 0 }}>{trip.status}</span>
      </div>

      <div className="flex items-start gap-2 text-sm" style={{ color: "var(--trackify-text)" }}>
        <MapPin size={14} style={{ color: "var(--text-3)", flexShrink: 0, marginTop: 2 }} />
        <span style={{ minWidth: 0 }}>
          {trip.origin} → {trip.destination}
        </span>
      </div>

      <ol className="tk-timeline">
        {trip.steps.map((s) => (
          <li key={s.label} className="tk-timeline-step" data-done={s.done ? "yes" : "no"}>
            <span className="tk-timeline-dot" aria-hidden="true" />
            <div style={{ minWidth: 0 }}>
              <div className="tk-timeline-label">
                {s.label}
                {s.planned && <span className="tk-timeline-planned">planned</span>}
              </div>
              <div className="tk-timeline-time">{fmt(s.at)}</div>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-1.5 pt-1" style={{ borderTop: "1px solid var(--line)" }}>
        <div className="flex items-center gap-2 text-xs pt-2" style={{ color: "var(--trackify-text-secondary)" }}>
          <User size={13} style={{ color: "var(--text-3)" }} />
          {trip.driver || "No driver assigned"}
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--trackify-text-secondary)" }}>
          <Truck size={13} style={{ color: "var(--text-3)" }} />
          {trip.vehicle || "No vehicle assigned"}
        </div>
      </div>

      <button
        className="ops-btn ops-btn-secondary"
        style={{ justifyContent: "center" }}
        onClick={() => navigate(`/operations/trips?trip=${trip.id}`)}
      >
        View trip
      </button>
    </div>
  );
}
