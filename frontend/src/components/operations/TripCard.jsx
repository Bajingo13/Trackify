import { Truck as TruckIcon, User } from "lucide-react";
import VehicleArt from "../fleet/VehicleArt";

/**
 * Trip "delivery card" — the route, its distance/ETA, the stop chain, and the
 * assigned truck with its load level, in one glanceable block.
 *
 * Same visual footprint as the fleet VehicleCard so trips and trucks read as
 * one family across Operations, Dispatch and Live Tracking.
 */

const STATUS = {
  draft:                { label: "Draft",       tone: "var(--st-draft)" },
  for_validation:       { label: "Validating",  tone: "var(--st-review)" },
  validated:            { label: "Validated",   tone: "var(--st-review)" },
  for_approval:         { label: "For approval", tone: "var(--st-review)" },
  approved:             { label: "Approved",    tone: "var(--st-approved)" },
  assigned:             { label: "Assigned",    tone: "var(--st-active)" },
  accepted:             { label: "Accepted",    tone: "var(--st-active)" },
  released:             { label: "Released",    tone: "var(--st-active)" },
  in_transit:           { label: "On route",    tone: "var(--st-transit)" },
  delivered:            { label: "Delivered",   tone: "var(--st-done)" },
  returned:             { label: "Returned",    tone: "var(--st-stopped)" },
  operationally_closed: { label: "Closed",      tone: "var(--st-done)" },
  cancelled:            { label: "Cancelled",   tone: "var(--st-stopped)" },
  rejected:             { label: "Rejected",    tone: "var(--st-stopped)" },
};

/** The card follows the house palette: our accent blue marks a live trip,
 *  a finished one recedes, and only a genuinely bad end state takes danger. */
const DONE = ["delivered", "operationally_closed"];
const STOPPED = ["cancelled", "rejected", "returned"];
function toneFor(status) {
  if (STOPPED.includes(status)) return "var(--danger)";
  if (DONE.includes(status)) return "var(--text-3)";
  return "var(--accent)";
}

/** Remaining time against the scheduled arrival — real field, no estimate. */
function timeLeft(t) {
  if (t.status !== "in_transit" || !t.scheduledArrival) return null;
  const mins = Math.round((new Date(t.scheduledArrival) - Date.now()) / 60000);
  if (Number.isNaN(mins)) return null;
  if (mins < 0) {
    const over = Math.abs(mins);
    return over < 60 ? `${over} min over` : `${Math.floor(over / 60)} h over`;
  }
  return mins < 60 ? `${mins} min left` : `${Math.floor(mins / 60)} h ${mins % 60} min left`;
}

const fmtKm = (km) => (km == null ? "—" : `${Number(km).toLocaleString()} km`);
const fmtMin = (m) =>
  m == null ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;

function Stat({ label, value }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: "var(--fs-11)", color: "var(--text-3)" }}>{label}</span>
      <span className="tk-mono" style={{ fontSize: "var(--fs-14)", fontWeight: 700, color: "var(--text)" }}>{value}</span>
    </div>
  );
}

export default function TripCard({ trip: t, onClick, selected = false, loadKg }) {
  if (!t) return null;
  const st = STATUS[t.status] || { label: t.status };
  const tone = toneFor(t.status);
  const left = timeLeft(t);
  const clickable = typeof onClick === "function";

  const stops = (t.stops || []).filter((s) => s?.label);
  const cargo = loadKg !== undefined ? loadKg : t.cargoWeight;
  const cap = t.vehicleCapacityKg ?? null;
  const ratio = cargo != null && cap > 0 ? Number(cargo) / cap : null;

  return (
    <div
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      style={{
        background: "var(--surface)",
        border: `1px solid ${selected ? "var(--accent)" : "var(--line)"}`,
        boxShadow: selected ? "var(--ring)" : "var(--shadow-1)",
        borderRadius: "var(--r-md)",
        overflow: "hidden",
        display: "grid",
        gridTemplateColumns: "minmax(140px, 0.85fr) minmax(0, 1.15fr)",
        cursor: clickable ? "pointer" : "default",
        transition: "border-color .15s, box-shadow .15s, transform .15s",
      }}
      onMouseEnter={clickable ? (e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "var(--shadow-2)"; } : undefined}
      onMouseLeave={clickable ? (e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = selected ? "var(--ring)" : "var(--shadow-1)"; } : undefined}
    >
      {/* left — identity + numbers */}
      <div style={{ padding: "var(--s-4)", display: "flex", flexDirection: "column", gap: "var(--s-3)", minWidth: 0 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--text-2)" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: tone, flexShrink: 0 }} />
          {st.label}
        </div>

        <div className="tk-mono" style={{ fontSize: "var(--fs-16)", fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {t.ticketNo}
        </div>

        <Stat label="Distance" value={fmtKm(t.routeKm)} />
        <Stat label="Estimated time" value={fmtMin(t.routeMin)} />
      </div>

      {/* right — route chain + truck */}
      <div style={{ background: "var(--surface-2)", padding: "var(--s-4)", display: "flex", flexDirection: "column", gap: "var(--s-2)", minWidth: 0, borderLeft: "1px solid var(--line-soft)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--s-2)" }}>
          <span style={{ fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {t.origin} – {t.destination}
          </span>
          <span style={{ flexShrink: 0, fontSize: "var(--fs-11)", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
            {left || t.customer || ""}
          </span>
        </div>

        {/* stop chain: origin, waypoints, destination */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "var(--fs-12)", minWidth: 0 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text)", fontWeight: 600 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.origin}</span>
          </span>
          {stops.slice(0, 2).map((s, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-2)", paddingLeft: 1 }}>
              <span style={{ color: "var(--text-3)", fontSize: 10, width: 6, textAlign: "center", flexShrink: 0 }}>↓</span>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
            </span>
          ))}
          {stops.length > 2 && (
            <span style={{ color: "var(--text-3)", paddingLeft: 13 }}>+{stops.length - 2} more stops</span>
          )}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-2)" }}>
            <span style={{ color: "var(--text-3)", fontSize: 10, width: 6, textAlign: "center", flexShrink: 0 }}>↓</span>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.destination}</span>
          </span>
        </div>

        {/* truck + who's driving */}
        <div style={{ marginTop: "auto", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "var(--s-2)", paddingTop: "var(--s-2)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "var(--fs-11)", color: "var(--text-2)", minWidth: 0 }}>
            {t.vehicle ? (
              <span className="tk-mono" style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <TruckIcon size={11} style={{ color: "var(--text-3)", flexShrink: 0 }} /> {t.vehicle}
              </span>
            ) : (
              <span style={{ color: "var(--text-3)" }}>Unassigned</span>
            )}
            {t.driver && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <User size={11} style={{ color: "var(--text-3)", flexShrink: 0 }} /> {t.driver}
              </span>
            )}
          </div>
          <VehicleArt
            type={t.vehicleType || "Box Truck"}
            height={46}
            muted={!t.vehicle}
            load={ratio}
            style={{ flexShrink: 0 }}
          />
        </div>
      </div>
    </div>
  );
}
