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

const kpiIcons = {
  tripsToday: <Route size={18} style={{ color: "#2455D6" }} />,
  inTransit: <Navigation size={18} style={{ color: "#1F4BC6" }} />,
  forApproval: <Clock size={18} style={{ color: "#102F8A" }} />,
  exceptions: <AlertTriangle size={18} style={{ color: "#C53030" }} />,
};
const kpiIconBgs = {
  tripsToday: "#EEF4FF", inTransit: "#E8F0FE", forApproval: "#EDF2FF", exceptions: "#FDECEC",
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
      <main className="max-w-[1400px] mx-auto pb-10">
        <DashboardHeader dateLabel={dateRange.label} />

        <div className="flex items-center justify-end gap-3 mb-3" style={{ maxWidth: 1400, margin: "0 auto" }}>
          <span className="text-[11px]" style={{ color: "var(--trackify-text-secondary)" }}>
            {refreshing ? "Refreshing…" : lastUpdated ? `Updated ${relativeTime(lastUpdated)}` : "Loading…"}
            <span style={{ marginLeft: 6, color: "#22C55E" }}>● auto</span>
          </span>
          <button className="ops-btn ops-btn-secondary" onClick={refresh} disabled={refreshing} style={{ padding: "6px 12px", fontSize: 12 }}>
            <RefreshCw size={13} style={refreshing ? { animation: "spin 0.8s linear infinite" } : undefined} /> Refresh
          </button>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
          {(kpiCards.length ? kpiCards : Array.from({ length: 4 })).map((card, i) => (
            <KPICard
              key={card?.id || i}
              index={i}
              label={card?.label || "—"}
              value={card?.value ?? 0}
              change={card?.change ?? 0}
              changeLabel={card?.changeLabel || ""}
              color={card?.color || "#2455D6"}
              sparkData={card?.sparkData || [0, 0, 0, 0, 0, 0, 0]}
              subtitle={card?.subtitle}
              icon={kpiIcons[card?.id]}
              iconBg={kpiIconBgs[card?.id]}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-4 mb-5">
          <TripActivityChart />
          <FleetAvailability data={d?.fleet} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-4 mb-5">
          <ActiveTrips trips={d?.activeTrips} />
          <TopRoutes />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
          <ApprovalQueue />
          <OperationalAlerts />
          <DeliveryPerformance onTimePct={d?.onTimePct} completed={d?.completed} />
        </div>

        <div className="text-center mt-6">
          <span className="text-[11px]" style={{ color: "var(--trackify-text-secondary)" }}>
            Auto-refreshes every 60 seconds{lastUpdated ? ` · last updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
        </div>
      </main>
    </AppShell>
  );
}
