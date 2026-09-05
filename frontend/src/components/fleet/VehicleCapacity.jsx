import { Package, AlertTriangle } from "lucide-react";
import VehicleArt from "./VehicleArt";

/**
 * "Current truck capacity" panel — the load level painted straight into the
 * cargo body, with the percentage called out.
 *
 * Used on the trip detail (how full is the assigned truck), Live Tracking's
 * selected trip, and the dispatch picker.
 *
 * capacityKg: the vehicle's rated capacity
 * loadKg:     the cargo actually on it (a trip's cargo weight)
 */
export default function VehicleCapacity({
  vehicle,
  loadKg,
  height = 96,
  title = "Current truck capacity",
  compact = false,
}) {
  if (!vehicle) return null;
  const cap = vehicle.capacityKg != null ? Number(vehicle.capacityKg) : null;
  const load = loadKg != null ? Number(loadKg) : null;
  const known = cap != null && cap > 0 && load != null;
  const ratio = known ? load / cap : null;
  const pct = ratio == null ? null : Math.round(ratio * 100);
  const over = ratio != null && ratio > 1;
  const tight = ratio != null && ratio >= 0.9 && !over;

  const tone = over ? "var(--danger)" : tight ? "var(--warn)" : "var(--accent)";
  const num = (n) => Number(n).toLocaleString();

  return (
    <div
      style={{
        background: "var(--surface)",
        border: `1px solid ${over ? "var(--danger-line)" : "var(--line)"}`,
        borderRadius: "var(--r-md)",
        padding: compact ? "var(--s-3)" : "var(--s-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--s-3)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--s-2)" }}>
        <span style={{ fontSize: "var(--fs-11)", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text-3)" }}>
          {title}
        </span>
        <span className="tk-mono" style={{ fontSize: "var(--fs-12)", color: "var(--text-2)" }}>
          {vehicle.plateNo}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "minmax(0,1fr) auto", gap: "var(--s-4)", alignItems: "center" }}>
        <div style={{ display: "grid", placeItems: "center", minWidth: 0 }}>
          <VehicleArt type={vehicle.type} height={height} load={ratio} style={{ maxWidth: "100%" }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span className="tk-mono" style={{ fontSize: "var(--fs-24, 26px)", fontWeight: 700, lineHeight: 1, color: tone }}>
            {pct == null ? "—" : `${pct}%`}
          </span>
          <span style={{ fontSize: "var(--fs-12)", color: "var(--text-2)" }}>
            {known ? `${num(load)} / ${num(cap)} kg` : cap != null ? `capacity ${num(cap)} kg` : "capacity not set"}
          </span>
        </div>
      </div>

      {/* linear bar mirrors the truck fill for precise reading */}
      <div>
        <div style={{ height: 8, borderRadius: "var(--r-pill)", background: "var(--surface-sunk)", overflow: "hidden" }}>
          <div
            style={{
              width: `${ratio == null ? 0 : Math.min(100, ratio * 100)}%`,
              height: "100%",
              background: tone,
              borderRadius: "var(--r-pill)",
              transition: "width .3s ease",
            }}
          />
        </div>
      </div>

      {over && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--danger-soft)", color: "var(--danger)", borderRadius: "var(--r-sm)", padding: "6px 10px", fontSize: "var(--fs-12)", fontWeight: 600 }}>
          <AlertTriangle size={13} /> Over capacity by {num(Math.round(load - cap))} kg
        </div>
      )}
      {tight && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--warn-soft)", color: "var(--warn)", borderRadius: "var(--r-sm)", padding: "6px 10px", fontSize: "var(--fs-12)", fontWeight: 600 }}>
          <Package size={13} /> Nearly full — {num(Math.round(cap - load))} kg headroom
        </div>
      )}
    </div>
  );
}
