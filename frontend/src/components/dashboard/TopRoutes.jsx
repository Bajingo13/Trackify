import { topRoutes as ROUTES_STUB } from "../../data/dashboardData";

const barColors = [
  "#2455D6",
  "#3F68D8",
  "#6284DF",
  "#8CA5EA",
  "#B6C7F2",
];

export default function TopRoutes({ data }) {
  const topRoutes = Array.isArray(data) && data.length ? data : ROUTES_STUB;
  const max = topRoutes.length > 0 ? Math.max(...topRoutes.map((r) => r.trips)) : 0;

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-base" style={{ color: "var(--trackify-text)" }}>Top Routes</span>
        <button className="text-xs font-semibold transition-opacity hover:opacity-70" style={{ color: "var(--trackify-blue)" }}>
          View all
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {topRoutes.length === 0 ? (
          <div className="text-sm text-center py-6" style={{ color: "var(--trackify-text-muted)" }}>No routes data</div>
        ) : topRoutes.map((route, i) => {
          const pct = (route.trips / max) * 100;
          return (
            <button
              key={route.route}
              className="flex items-center gap-3 w-full text-left group"
              aria-label={`${route.route}, ${route.trips} trips, ${route.onTime == null ? "on-time rate not available" : route.onTime + "% on-time"}`}
            >
              {/* Route rank */}
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold transition-opacity group-hover:opacity-80"
                style={{
                  background: "var(--trackify-surface-blue)",
                  color: "var(--trackify-blue)",
                }}
              >
                {i + 1}
              </div>

              {/* Route + bar */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium leading-none" style={{ color: "var(--trackify-text)" }}>
                    {route.route}
                  </span>
                  <span className="text-xs font-semibold" style={{ color: "var(--trackify-text-secondary)" }}>
                    {route.trips} Trips
                  </span>
                </div>
                <div
                  className="h-1 rounded-full"
                  style={{ background: "var(--trackify-border-soft)", maxWidth: "100%" }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: barColors[i % barColors.length] }}
                  />
                </div>
                <div className="text-[11px] mt-1" style={{ color: "var(--trackify-text-secondary)" }}>
                  {route.onTime == null ? "— On-time" : `${route.onTime}% On-time`}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
