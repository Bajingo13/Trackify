import VehicleArt from "../fleet/VehicleArt";

/**
 * Dispatch banner: what the yard can actually take on right now.
 *
 * Every figure is summed from the same board payload the columns below use —
 * the capacity is the real sum of the available vehicles' capacity field, not
 * a fleet-wide total, so it answers "how much can I still commit today".
 */
export default function DispatchHero({ trips = [], drivers = [], vehicles = [] }) {
  const capacity = vehicles.reduce((sum, v) => sum + (Number(v.capacity) || 0), 0);
  const withCapacity = vehicles.filter((v) => Number(v.capacity) > 0).length;
  const waiting = trips.length;
  const ready = Math.min(drivers.length, vehicles.length);

  return (
    <div className="tk-dispatch-hero">
      <div className="tk-dispatch-art">
        <VehicleArt
          type={vehicles[0]?.type || "Tractor Trailer"}
          height={104}
          muted={vehicles.length === 0}
          animated={vehicles.length > 0}
          style={{ width: "100%", maxWidth: 300 }}
        />
      </div>

      <div className="tk-dispatch-figures">
        <div className="tk-dispatch-figure">
          <span className="tk-dispatch-label">Available capacity</span>
          <span className="tk-dispatch-value">
            {capacity > 0 ? `${capacity.toLocaleString()} kg` : "—"}
          </span>
          <span className="tk-dispatch-note">
            {withCapacity > 0
              ? `across ${withCapacity} available ${withCapacity === 1 ? "unit" : "units"}`
              : "no capacity recorded on available units"}
          </span>
        </div>

        <div className="tk-dispatch-figure">
          <span className="tk-dispatch-label">Ready to pair</span>
          <span className="tk-dispatch-value">{ready}</span>
          <span className="tk-dispatch-note">
            {drivers.length} {drivers.length === 1 ? "driver" : "drivers"} · {vehicles.length}{" "}
            {vehicles.length === 1 ? "vehicle" : "vehicles"}
          </span>
        </div>

        <div className="tk-dispatch-figure">
          <span className="tk-dispatch-label">Waiting on dispatch</span>
          <span className="tk-dispatch-value">{waiting}</span>
          <span className="tk-dispatch-note">
            {waiting === 0 ? "every approved trip is assigned" : "approved, not yet assigned"}
          </span>
        </div>
      </div>
    </div>
  );
}
