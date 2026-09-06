import { Info, Truck, Wrench, XCircle } from "lucide-react";
import { fleetAvailability as FA_STUB } from "../../data/dashboardData";

const segments = [
  { key: "available", label: "Available", color: "#2455D6", icon: Truck },
  { key: "onTrip", label: "On Trip", color: "#1F4BC6", icon: Truck },
  { key: "maintenance", label: "Under Maintenance", color: "#D4A017", icon: Wrench },
  { key: "unavailable", label: "Unavailable", color: "#94A3BD", icon: XCircle },
];

export default function FleetAvailability({ data }) {
  const fleetAvailability = data || FA_STUB;
  const total = fleetAvailability.total;

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-base" style={{ color: "var(--trackify-text)" }}>Fleet Availability</span>
          <button aria-label="Fleet availability info" className="opacity-50 hover:opacity-80 transition-opacity">
            <Info size={14} />
          </button>
        </div>
        <button className="text-xs font-semibold transition-opacity hover:opacity-70" style={{ color: "var(--trackify-blue)" }}>
          View all
        </button>
      </div>

      {/* Visual bar */}
      <div className="flex h-3 rounded-full overflow-hidden" style={{ background: "var(--trackify-surface-blue)" }}>
        {segments.map((seg) => {
          const pct = total > 0 ? (fleetAvailability[seg.key] / total) * 100 : 0;
          return (
            <div
              key={seg.key}
              style={{ width: `${pct}%`, background: seg.color }}
              className="transition-all duration-500"
              title={`${seg.label}: ${fleetAvailability[seg.key]}`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-2.5">
        {segments.map((seg) => (
          <div key={seg.key} className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: seg.color }}
              />
              <span className="text-sm" style={{ color: "var(--trackify-text-secondary)" }}>{seg.label}</span>
            </div>
            <span className="text-sm font-semibold" style={{ color: "var(--trackify-text)" }}>
              {fleetAvailability[seg.key]}
            </span>
          </div>
        ))}
      </div>

      {/* Total */}
      <div
        className="flex items-center justify-between pt-3 border-t"
        style={{ borderColor: "var(--trackify-border)" }}
      >
        <span className="text-sm font-semibold" style={{ color: "var(--trackify-text)" }}>Total Fleet</span>
        <span className="text-lg font-bold" style={{ color: "var(--trackify-text)" }}>{total}</span>
      </div>
    </div>
  );
}
