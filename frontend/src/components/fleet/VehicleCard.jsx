import { Gauge, Wrench, Package, MapPin, User, Route as RouteIcon } from "lucide-react";
import VehiclePhoto from "./VehiclePhoto";

/**
 * The vehicle "spec card" used everywhere a truck is shown as an object rather
 * than a table row — Fleet, Dispatch, Live Tracking, trip Assignment.
 *
 * Keeping one component means the same footprint (illustration + plate + status
 * + specs) reads identically across modules.
 *
 * vehicle: the mapped shape from services/fleet/vehicleService
 * variant: "full" (default) | "compact" (picker / side panel)
 */

const STATUS_TONE = {
  Available: ["var(--ok)", "var(--ok-soft)", "var(--ok-line)"],
  "On Trip": ["var(--accent)", "var(--accent-soft)", "var(--accent-line)"],
  Maintenance: ["var(--warn)", "var(--warn-soft)", "var(--warn-line)"],
  Retired: ["var(--text-3)", "var(--surface-sunk)", "var(--line)"],
  Inactive: ["var(--text-3)", "var(--surface-sunk)", "var(--line)"],
};

const SERVICE_TONE = {
  overdue: ["var(--danger)", "var(--danger-soft)", "Service overdue"],
  "due-soon": ["var(--warn)", "var(--warn-soft)", "Service due soon"],
  ok: ["var(--ok)", "var(--ok-soft)", "Service OK"],
};

const num = (n) => (n == null ? "—" : Number(n).toLocaleString());

function Spec({ icon: Icon, label, value, tone }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--fs-11)", color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>
        <Icon size={11} /> {label}
      </span>
      <span className="tk-mono" style={{ fontSize: "var(--fs-13)", fontWeight: 600, color: tone || "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {value}
      </span>
    </div>
  );
}

export default function VehicleCard({
  vehicle: v,
  variant = "full",
  selected = false,
  onClick,
  footer,
  loadKg = null,   // cargo weight to visualise inside the body
}) {
  if (!v) return null;
  const [fg, bg, line] = STATUS_TONE[v.status] || STATUS_TONE.Available;
  const svc = v.serviceStatus ? SERVICE_TONE[v.serviceStatus] : null;
  const idle = v.status === "Retired" || v.status === "Inactive";
  const compact = variant === "compact";
  const clickable = typeof onClick === "function";

  const cap = v.capacityKg != null ? Number(v.capacityKg) : null;
  const ratio = loadKg != null && cap > 0 ? Number(loadKg) / cap : null;
  const overCap = ratio != null && ratio > 1;

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
        padding: compact ? "var(--s-3)" : "var(--s-4)",
        display: "flex",
        flexDirection: "column",
        gap: compact ? "var(--s-2)" : "var(--s-3)",
        cursor: clickable ? "pointer" : "default",
        transition: "border-color .15s, box-shadow .15s, transform .15s",
        minWidth: 0,
      }}
      onMouseEnter={clickable ? (e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "var(--shadow-2)"; } : undefined}
      onMouseLeave={clickable ? (e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = selected ? "var(--ring)" : "var(--shadow-1)"; } : undefined}
    >
      {/* plate + status */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--s-2)" }}>
        <div style={{ minWidth: 0 }}>
          <div className="tk-mono" style={{ fontSize: compact ? "var(--fs-13)" : "var(--fs-15)", fontWeight: 700, color: "var(--text)", letterSpacing: ".01em" }}>
            {v.plateNo}
          </div>
          <div style={{ fontSize: "var(--fs-12)", color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {[v.type, [v.brand, v.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span style={{ flexShrink: 0, fontSize: "var(--fs-11)", fontWeight: 600, color: fg, background: bg, border: `1px solid ${line}`, borderRadius: "var(--r-pill)", padding: "2px 9px" }}>
          {v.status}
        </span>
      </div>

      {/* the truck */}
      <div style={{ display: "grid", placeItems: "center", padding: compact ? "2px 0" : "var(--s-2) 0" }}>
        {/* A unit out on a run moves; one sitting in the yard does not. The
            card is a status surface, so the motion has to mean something. */}
        <VehiclePhoto
          type={v.type}
          height={compact ? 54 : 76}
          muted={idle}
          animated={v.status === "On Trip"}
          load={ratio}
          style={{ maxWidth: "100%" }}
        />
      </div>

      {/* load fit — only when a cargo weight is in play (dispatch picker) */}
      {ratio != null && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--s-2)", fontSize: "var(--fs-12)", fontWeight: 600, color: overCap ? "var(--danger)" : ratio >= 0.9 ? "var(--warn)" : "var(--text-2)" }}>
          <span>{overCap ? "Over capacity" : `${Math.round(ratio * 100)}% loaded`}</span>
          <span className="tk-mono" style={{ color: "var(--text-3)", fontWeight: 500 }}>
            {Number(loadKg).toLocaleString()} / {num(cap)} kg
          </span>
        </div>
      )}

      {/* specs */}
      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr 1fr" : "1fr 1fr 1fr", gap: "var(--s-3)", borderTop: "1px solid var(--line-soft)", paddingTop: compact ? "var(--s-2)" : "var(--s-3)" }}>
        <Spec icon={Package} label="Capacity" value={v.capacityKg != null ? `${num(v.capacityKg)} kg` : "—"} />
        <Spec icon={Gauge} label="Odometer" value={`${num(v.odometerReading)} km`} />
        {!compact && (
          <Spec
            icon={Wrench}
            label="Service"
            value={v.kmToService != null ? `${num(v.kmToService)} km` : "—"}
            tone={svc ? svc[0] : undefined}
          />
        )}
      </div>

      {/* service banner (only when it needs attention) */}
      {!compact && svc && v.serviceStatus !== "ok" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: svc[1], color: svc[0], border: `1px solid ${svc[0]}33`, borderRadius: "var(--r-sm)", padding: "5px 9px", fontSize: "var(--fs-12)", fontWeight: 600 }}>
          <Wrench size={12} /> {svc[2]}
        </div>
      )}

      {/* contextual footer — branch / current trip / driver */}
      {footer !== undefined ? footer : (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", flexWrap: "wrap", fontSize: "var(--fs-12)", color: "var(--text-2)" }}>
          {v.homeBranch && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <MapPin size={12} style={{ color: "var(--text-3)" }} /> {v.homeBranch}
            </span>
          )}
          {v.currentTrip && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--accent)" }}>
              <RouteIcon size={12} /> {v.currentTrip}
            </span>
          )}
          {v.driverName && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <User size={12} style={{ color: "var(--text-3)" }} /> {v.driverName}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
