import VehicleArt from "../fleet/VehicleArt";

/**
 * Vehicles currently out on trips, against the fleet total. The silhouette is
 * decoration here rather than a specific unit, so it uses the generic box
 * truck instead of implying a type the number does not have.
 */
export default function FleetOnRoad({ fleet }) {
  const onTrip = fleet?.onTrip ?? 0;
  const total = fleet?.total ?? 0;
  const available = fleet?.available ?? 0;

  return (
    <div className="card p-5 flex flex-col gap-1">
      <div className="font-semibold text-base" style={{ color: "var(--trackify-text)" }}>
        Vehicles On The Road
      </div>
      <div className="text-[11px]" style={{ color: "var(--trackify-text-muted)" }}>
        Units currently out on a trip
      </div>

      {fleet?.readable === false ? (
        <div className="text-sm py-6" style={{ color: "var(--trackify-text-secondary)" }}>
          Fleet figures are not available to your role.
        </div>
      ) : (
      <div className="flex items-end justify-between gap-3 mt-1">
        <div>
          <div
            style={{
              fontSize: "var(--fs-32)",
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              color: "var(--text)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {onTrip}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "var(--trackify-text-muted)" }}>
            of {total} in the fleet · {available} available
          </div>
        </div>
        <VehicleArt type="Box Truck" height={54} muted={onTrip === 0} animated={onTrip > 0} style={{ flexShrink: 0 }} />
      </div>
      )}
    </div>
  );
}
