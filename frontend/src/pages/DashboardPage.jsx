import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import AppShell from "../components/layout/AppShell";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import KpiStrip from "../components/dashboard/KpiStrip";
import OnTimeGauge from "../components/dashboard/OnTimeGauge";
import FleetOnRoad from "../components/dashboard/FleetOnRoad";
import TripProgress from "../components/dashboard/TripProgress";
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
import { usePermissions } from "../auth/permissions";
import { useRealtime } from "../services/realtime";

export default function DashboardPage() {
  const [d, setD] = useState(null);
  const { can } = usePermissions();
  const load = useCallback(async () => { setD(await getDashboardSummary(can)); }, [can]);
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
            <span style={{ marginLeft: 6, color: "var(--ok)" }}>● auto</span>
          </span>
          <button className="ops-btn ops-btn-secondary" onClick={refresh} disabled={refreshing} style={{ padding: "6px 12px", fontSize: 12 }}>
            <RefreshCw size={13} style={refreshing ? { animation: "spin 0.8s linear infinite" } : undefined} /> Refresh
          </button>
        </div>

        {/* the four headline counts, one divided strip */}
        <div className="mb-4">
          <KpiStrip cards={kpiCards} />
        </div>

        {/* chart | performance + fleet | the run to watch */}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 mb-4">
          <TripActivityChart data={d?.tripActivity} />
          <div className="flex flex-col gap-4">
            <OnTimeGauge pct={d?.onTimePct} closedCount={d?.completed} />
            <FleetOnRoad fleet={d?.fleet} />
          </div>
          <TripProgress trip={d?.focusTrip} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 mb-4">
          <ActiveTrips trips={d?.activeTrips} />
          <div className="flex flex-col gap-4">
            <FleetAvailability data={d?.fleet} />
            <TopRoutes data={d?.topRoutes} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ApprovalQueue />
          <OperationalAlerts />
        </div>

      </main>
    </AppShell>
  );
}
