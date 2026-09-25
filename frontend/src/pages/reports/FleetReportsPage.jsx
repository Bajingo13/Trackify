import LoadFailure, { StaleData } from "../../components/shared/LoadFailure";
import { useEffect, useState } from "react";
import { Truck, Users, Wrench, Gauge } from "lucide-react";
import AppShell from "../../components/layout/AppShell";
import { PageHeader, StatCard } from "../../components/ui";
import { getFleetReport } from "../../services/reports/reportsService";
import { useAutoRefresh } from "../../hooks/useAutoRefresh";
import { todayInput } from "../../utils/date";
import {
  Bar, RangeCard, ReportActions, ChartCard, barSheet,
  chartsGrid, kpiGrid,
} from "./reportKit";

const peso = (n) => `₱${Math.round(n || 0).toLocaleString()}`;

/**
 * Fleet report.
 *
 * The figures are counted by the database rather than in the browser. This page
 * used to ask for five thousand vehicles, five thousand drivers and five
 * thousand maintenance records on every load and every auto-refresh, then add
 * them up here — which is fine on demo data and gets worse every week a real
 * operator uses it.
 *
 * Because the date range is now applied server-side, changing it has to refetch
 * rather than re-filter what is already in memory.
 */
const EMPTY = {
  vehicles: { total: 0, availabilityPct: 0, statusRows: [], typeRows: [] },
  drivers: { total: 0, atRisk: 0, statusRows: [], licenceRows: [] },
  maintenance: { count: 0, totalCost: 0, typeRows: [], statusRows: [], costRows: [] },
};

export default function FleetReportsPage() {
  const [data, setData] = useState(EMPTY);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = async () => setData(await getFleetReport({ from, to }));
  const { refreshing, lastUpdated, refresh, error, loaded } = useAutoRefresh(load, 60000);

  // The hook holds the latest `load` in a ref and `refresh` is stable, so this
  // re-runs the query with the new range rather than re-filtering stale rows.
  useEffect(() => { refresh(); }, [from, to, refresh]);

  const veh = data.vehicles || EMPTY.vehicles;
  const drv = data.drivers || EMPTY.drivers;
  const mnt = data.maintenance || EMPTY.maintenance;
  const costRows = (mnt.costRows || []).map((r) => ({ ...r, display: peso(r.value) }));

  const buildExport = () => ({
    filename: `Fleet Report ${todayInput()}`,
    title: "AstreaBlue Trackify — Fleet Report",
    meta: [
      ["Generated", new Date().toLocaleString()],
      ["Maintenance date range", (from || to) ? `${from || "start"} to ${to || "today"}` : "All time"],
    ],
    sheets: [
      { name: "Summary", rows: [
        ["Metric", "Value"],
        ["Vehicles", veh.total],
        ["Fleet availability %", veh.availabilityPct],
        ["Drivers", drv.total],
        ["Driver licences at risk", drv.atRisk],
        ["Maintenance records in range", mnt.count],
        ["Maintenance spend (completed)", peso(mnt.totalCost)],
      ] },
      barSheet("Vehicles by status", ["Status", "Count"], veh.statusRows),
      barSheet("Vehicles by type", ["Type", "Count"], veh.typeRows),
      barSheet("Drivers by status", ["Status", "Count"], drv.statusRows),
      barSheet("Driver licences", ["Licence status", "Count"], drv.licenceRows),
      barSheet("Maintenance by type", ["Type", "Count"], mnt.typeRows),
      barSheet("Maintenance by status", ["Status", "Count"], mnt.statusRows),
      barSheet("Maintenance spend by vehicle", ["Vehicle", "Spend (PHP)"], costRows),
    ],
  });

  /*
   * Nothing has ever arrived and the last attempt failed. Rendering the page
   * below would show this screen's empty defaults — zeros that read as real
   * figures — so it says plainly that nothing was loaded.
   */
  if (!loaded && error) {
    return (
      <AppShell pageKey="reports-fleet">
        <PageHeader eyebrow="Reports" title="Fleet Report" />
        <LoadFailure error={error} onRetry={refresh} retrying={refreshing} what="the fleet report" />
      </AppShell>
    );
  }

  return (
    <AppShell pageKey="reports-fleet">
      <PageHeader
        eyebrow="Reports"
        title="Fleet Report"
        subtitle="Vehicle availability, driver readiness and maintenance spend"
        actions={<ReportActions build={buildExport} refreshing={refreshing} lastUpdated={lastUpdated} onRefresh={refresh} />}
      />

        {/* Figures are on screen but the newest refresh failed: keep them,
            and say how old they are rather than implying they are current. */}
        {error && (
          <StaleData error={error} onRetry={refresh} retrying={refreshing} lastUpdated={lastUpdated} />
        )}

      <RangeCard
        from={from} to={to} setFrom={setFrom} setTo={setTo}
        summary={`${mnt.count} maintenance records${(from || to) ? " in range" : ""}`}
      />

      <div style={kpiGrid}>
        <StatCard index={0} label="Vehicles" value={veh.total} icon={Truck} tone="accent" />
        <StatCard index={1} label="Availability %" value={veh.availabilityPct} icon={Gauge} tone={veh.availabilityPct < 70 ? "warn" : "ok"} hint="of active fleet" />
        <StatCard index={2} label="Drivers" value={drv.total} icon={Users} tone="accent" hint={drv.atRisk ? `${drv.atRisk} licence at risk` : "licences valid"} />
        <StatCard index={3} label="Maint. cost (₱)" value={Math.round(mnt.totalCost)} icon={Wrench} tone="accent" hint="completed jobs" />
      </div>

      <div style={chartsGrid}>
        <ChartCard title="Vehicles by status"><Bar rows={veh.statusRows} /></ChartCard>
        <ChartCard title="Vehicles by type"><Bar rows={veh.typeRows} tone="var(--st-transit, var(--accent))" /></ChartCard>
        <ChartCard title="Drivers by status"><Bar rows={drv.statusRows} /></ChartCard>
        <ChartCard title="Driver licences"><Bar rows={drv.licenceRows} /></ChartCard>
        <ChartCard title="Maintenance by type"><Bar rows={mnt.typeRows} tone="var(--warn)" /></ChartCard>
        <ChartCard title="Maintenance by status"><Bar rows={mnt.statusRows} /></ChartCard>
        <ChartCard title="Maintenance spend by vehicle" wide footer="Completed jobs with a recorded cost.">
          <Bar rows={costRows} tone="var(--accent)" />
        </ChartCard>
      </div>
    </AppShell>
  );
}
