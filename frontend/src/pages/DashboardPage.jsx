import { useState, useEffect, useCallback } from "react";
import { Route, Navigation, Clock, AlertTriangle, RefreshCw } from "lucide-react";
import AppShell from "../components/layout/AppShell";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import KPICard from "../components/dashboard/KPICard";
import TripActivityChart from "../components/dashboard/TripActivityChart";
import FleetAvailability from "../components/dashboard/FleetAvailability";
import ActiveTrips from "../components/dashboard/ActiveTrips";
import TopRoutes from "../components/dashboard/TopRoutes";
import ApprovalQueue from "../components/dashboard/ApprovalQueue";
import OperationalAlerts from "../components/dashboard/OperationalAlerts";
import DeliveryPerformance from "../components/dashboard/DeliveryPerformance";
import { dateRange } from "../data/dashboardData";
import { getDashboardSummary } from "../services/dashboardService";
import { useAutoRefresh, relativeTime } from "../hooks/useAutoRefresh";
import { useRealtime } from "../services/realtime";

// Monochrome: the icons take the card colour, they do not introduce their own.
const kpiIcons = {
  tripsToday: <Route size={16} />,
  inTransit: <Navigation size={16} />,
  forApproval: <Clock size={16} />,
  exceptions: <AlertTriangle size={16} />,
};

export default function DashboardPage() {
  const [d, setD] = useState(null);
  const load = useCallback(async () => { setD(await getDashboardSummary()); }, []);
  const { refreshing, lastUpdated, refresh } = useAutoRefresh(load, 60000);
  // trip status changes (assign/release/deliver/close/...) refresh the summary right away
  useRealtime((msg) => { if (msg.type === "trip:status") load(); });
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 20000); return () => clearInterval(id); }, []);

  const kpiCards = d?.kpiCards || [];

  return (
    <AppShell pageKey="dashboard">
      <main className="pb-8">
        <DashboardHeader dateLabel={dateRange.label} />

        <div className="flex items-center justify-end gap-3 mb-3">
          <span className="text-[11px]" style={{ color: "var(--trackify-text-secondary)" }}>
            {refreshing ? "Refreshing…" : lastUpdated ? `Updated ${relativeTime(lastUpdated)}` : "Loading…"}
            <span style={{ marginLeft: 6, color: "#22C55E" }}>● auto</span>
          </span>
          <button className="ops-btn ops-btn-secondary" onClick={refresh} disabled={refreshing} style={{ padding: "6px 12px", fontSize: 12 }}>
            <RefreshCw size={13} style={refreshing ? { animation: "spin 0.8s linear infinite" } : undefined} /> Refresh
          </button>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
          {(kpiCards.length ? kpiCards : Array.from({ length: 4 })).map((card, i) => (
            <KPICard
              key={card?.id || i}
              index={i}
              label={card?.label || "—"}
              value={card?.value ?? 0}
              changeLabel={card?.changeLabel || ""}
              sparkData={card?.sparkData || [0, 0, 0, 0, 0, 0, 0]}
              subtitle={card?.subtitle}
              icon={kpiIcons[card?.id]}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-4 mb-4">
          <TripActivityChart data={d?.tripActivity} />
          <div className="flex flex-col gap-4">
            <FleetAvailability data={d?.fleet} />
            <DeliveryPerformance onTimePct={d?.onTimePct} completed={d?.completed} />
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-4 mb-4">
          <ActiveTrips trips={d?.activeTrips} />
          <TopRoutes data={d?.topRoutes} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ApprovalQueue />
          <OperationalAlerts />
        </div>

      </main>
    </AppShell>
  );
}
