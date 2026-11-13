import { AlertTriangle, Clock3, MapPin } from "lucide-react";
import { estimateLiveEta, formatEtaClock, formatGpsAge } from "../../services/operations/liveEta";

/** One compact, honest ETA treatment shared by Live Tracking details. */
export default function LiveEtaCard({ trip, tracking, route, now = Date.now() }) {
  const eta = estimateLiveEta({ trip, tracking, route, now });
  const warning = ["stale", "no-gps", "unmatched", "paused"].includes(eta.kind);

  return (
    <section className="live-eta-card" data-kind={eta.kind} aria-label="Estimated arrival">
      <div className="live-eta-icon" aria-hidden="true">
        {warning ? <AlertTriangle size={17} /> : <Clock3 size={17} />}
      </div>
      <div className="live-eta-content">
        <div className="live-eta-main">
          <span className="live-eta-label">{eta.label}</span>
          <strong className="live-eta-time">{eta.etaAt == null ? "Not available" : formatEtaClock(eta.etaAt)}</strong>
          <span className="live-eta-note">{eta.notice || "Recorded arrival time."}</span>
        </div>
        <div className="live-eta-meta">
          {eta.kind === "live" && eta.distanceRemainingKm != null && (
            <span><MapPin size={12} /> About {Math.round(eta.distanceRemainingKm)} km remaining</span>
          )}
          {eta.updatedAt != null && eta.kind !== "arrived" && (
            <span>GPS updated {formatGpsAge(eta.gpsAgeMs)}</span>
          )}
          <small>Route timing only · no live traffic</small>
        </div>
      </div>
    </section>
  );
}
