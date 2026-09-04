import { useMemo, useState } from "react";
import { Truck, Users, Wrench, Gauge } from "lucide-react";
import AppShell from "../../components/layout/AppShell";
import { PageHeader, StatCard } from "../../components/ui";
import { getAllVehicles } from "../../services/fleet/vehicleService";
import { getAllDrivers, getLicenseExpiryStatus } from "../../services/fleet/driverService";
import { getAllMaintenance } from "../../services/fleet/maintenanceService";
import { useAutoRefresh } from "../../hooks/useAutoRefresh";
import { todayInput } from "../../utils/date";
import {
  Bar, RangeCard, ReportActions, ChartCard, makeInRange, barSheet,
  chartsGrid, kpiGrid,
} from "./reportKit";

const peso = (n) => `₱${Math.round(n || 0).toLocaleString()}`;

export default function FleetReportsPage() {
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [maint, setMaint] = useState([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = async () => {
    const [v, d, m] = await Promise.all([
      getAllVehicles({ limit: 5000 }),
      getAllDrivers({ limit: 5000 }),
      getAllMaintenance({ limit: 5000 }),
    ]);
    setVehicles(v.data || []);
    setDrivers(d.data || []);
    setMaint(m.data || []);
  };
  const { refreshing, lastUpdated, refresh } = useAutoRefresh(load, 60000);

  const inRange = makeInRange(from, to);

  const veh = useMemo(() => {
    const byStatus = {};
    const byType = {};
    vehicles.forEach((x) => {
      byStatus[x.status] = (byStatus[x.status] || 0) + 1;
      byType[x.type] = (byType[x.type] || 0) + 1;
    });
    const active = vehicles.filter((x) => x.status !== "Retired").length;
    const available = byStatus.Available || 0;
    return {
      total: vehicles.length,
      availabilityPct: active ? Math.round((available / active) * 100) : 0,
      statusRows: Object.entries(byStatus).map(([k, v]) => ({
        key: k, label: k, value: v,
        tone: k === "Available" ? "var(--ok, var(--accent))" : k === "Maintenance" ? "var(--warn)" : k === "Retired" ? "var(--text-3)" : "var(--accent)",
      })),
      typeRows: Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: k, value: v })),
    };
  }, [vehicles]);

  const drv = useMemo(() => {
    const byStatus = {};
    const byLicence = { Valid: 0, "Expiring Soon": 0, Expired: 0 };
    drivers.forEach((x) => {
      byStatus[x.status] = (byStatus[x.status] || 0) + 1;
      byLicence[getLicenseExpiryStatus(x.licenseExpiry)] += 1;
    });
    return {
      total: drivers.length,
      atRisk: byLicence["Expiring Soon"] + byLicence.Expired,
      statusRows: Object.entries(byStatus).map(([k, v]) => ({ key: k, label: k, value: v })),
      licenceRows: [
        { key: "v", label: "Valid", value: byLicence.Valid, tone: "var(--accent)" },
        { key: "s", label: "Expiring Soon", value: byLicence["Expiring Soon"], tone: "var(--warn)" },
        { key: "e", label: "Expired", value: byLicence.Expired, tone: "var(--danger)" },
      ],
    };
  }, [drivers]);

  const mnt = useMemo(() => {
    const rows = (from || to) ? maint.filter((x) => inRange(x.serviceDate || x.createdAt)) : maint;
    const byType = {};
    const byStatus = {};
    const costByVehicle = {};
    let totalCost = 0;
    rows.forEach((x) => {
      byType[x.type] = (byType[x.type] || 0) + 1;
      byStatus[x.status] = (byStatus[x.status] || 0) + 1;
      if (x.status === "Completed" && x.cost) {
        totalCost += x.cost;
        costByVehicle[x.vehiclePlate || "—"] = (costByVehicle[x.vehiclePlate || "—"] || 0) + x.cost;
      }
    });
    return {
      count: rows.length,
      totalCost,
      typeRows: Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ key: k, label: k, value: v })),
      statusRows: Object.entries(byStatus).map(([k, v]) => ({
        key: k, label: k, value: v,
        tone: k === "Completed" ? "var(--accent)" : k === "Cancelled" ? "var(--text-3)" : k === "In Progress" ? "var(--warn)" : "var(--accent)",
      })),
      costRows: Object.entries(costByVehicle).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, v]) => ({ key: k, label: k, value: Math.round(v), display: peso(v) })),
    };
  }, [maint, from, to]);

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
      barSheet("Maintenance spend by vehicle", ["Vehicle", "Spend (PHP)"], mnt.costRows),
    ],
  });

  return (
    <AppShell pageKey="reports-fleet">
      <PageHeader
        eyebrow="Reports"
        title="Fleet Report"
        subtitle="Vehicle availability, driver readiness and maintenance spend"
        actions={<ReportActions build={buildExport} refreshing={refreshing} lastUpdated={lastUpdated} onRefresh={refresh} />}
      />

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
          <Bar rows={mnt.costRows} tone="var(--accent)" />
        </ChartCard>
      </div>
    </AppShell>
  );
}
