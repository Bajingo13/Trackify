import LoadFailure, { StaleData } from "../../components/shared/LoadFailure";
import { useMemo, useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import AppShell from "../../components/layout/AppShell";
import { PageHeader, StatCard } from "../../components/ui";
import { getFilteredComplianceAlerts } from "../../services/fleet/complianceService";
import { useAutoRefresh } from "../../hooks/useAutoRefresh";
import { Bar, ReportActions, ChartCard, chartsGrid, kpiGrid, titleCase, barSheet } from "./reportKit";
import { formatDate, todayInput } from "../../utils/date";

const docLabel = (t) => titleCase(String(t).replace(/^(driver|vehicle)_/, ""));

export default function ComplianceReportsPage() {
  const [alerts, setAlerts] = useState([]);

  const load = async () => setAlerts(await getFilteredComplianceAlerts());
  const { refreshing, lastUpdated, refresh, error, loaded } = useAutoRefresh(load, 60000);

  const c = useMemo(() => {
    const byPriority = { CRITICAL: 0, WARNING: 0, INFO: 0 };
    const byEntity = { Driver: 0, Vehicle: 0 };
    const byDoc = {};
    alerts.forEach((a) => {
      byPriority[a.priority] = (byPriority[a.priority] || 0) + 1;
      byEntity[a.entity] = (byEntity[a.entity] || 0) + 1;
      byDoc[a.type] = (byDoc[a.type] || 0) + 1;
    });
    const upcoming = [...alerts]
      .sort((a, b) => (a.daysToExpiry ?? 1e9) - (b.daysToExpiry ?? 1e9))
      .slice(0, 12);
    return {
      total: alerts.length,
      critical: byPriority.CRITICAL,
      warning: byPriority.WARNING,
      info: byPriority.INFO,
      priorityRows: [
        { key: "c", label: "Critical (expired)", value: byPriority.CRITICAL, tone: "var(--danger)" },
        { key: "w", label: "Warning (expiring)", value: byPriority.WARNING, tone: "var(--warn)" },
        { key: "i", label: "Info (valid)", value: byPriority.INFO, tone: "var(--accent)" },
      ],
      entityRows: [
        { key: "d", label: "Drivers", value: byEntity.Driver, tone: "var(--accent)" },
        { key: "v", label: "Vehicles", value: byEntity.Vehicle, tone: "var(--st-transit, var(--accent))" },
      ],
      docRows: Object.entries(byDoc).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, v]) => ({ key: k, label: docLabel(k), value: v })),
      upcoming,
    };
  }, [alerts]);

  const buildExport = () => ({
    filename: `Compliance Report ${todayInput()}`,
    title: "AstreaBlue Trackify — Compliance Report",
    meta: [
      ["Generated", new Date().toLocaleString()],
      ["Window", "Next 120 days"],
      ["Tracked items", c.total],
    ],
    sheets: [
      { name: "Summary", rows: [
        ["Metric", "Count"],
        ["Expired (critical)", c.critical],
        ["Expiring soon (warning)", c.warning],
        ["Valid (info)", c.info],
      ] },
      barSheet("By priority", ["Priority", "Count"], c.priorityRows),
      barSheet("By record type", ["Record type", "Count"], c.entityRows),
      barSheet("By document", ["Document", "Count"], c.docRows),
      { name: "Soonest expirations", rows: [
        ["Record", "Type", "Document", "Expiry", "Days to expiry", "Priority"],
        ...c.upcoming.map((a) => [
          a.entityName, a.entity, docLabel(a.type), formatDate(a.expiryDate),
          a.daysToExpiry < 0 ? `${Math.abs(a.daysToExpiry)} overdue` : a.daysToExpiry,
          a.priority,
        ]),
      ] },
    ],
  });

  /*
   * Nothing has ever arrived and the last attempt failed. Rendering the
   * page below would show this screen's empty defaults, which read as
   * real figures, so it says plainly that nothing was loaded.
   */
  if (!loaded && error) {
    return (
      <AppShell pageKey="reports-compliance">
        <PageHeader eyebrow="Reports" title="Compliance Report" />
        <LoadFailure error={error} onRetry={refresh} retrying={refreshing} what="the compliance report" />
      </AppShell>
    );
  }

  return (
    <AppShell pageKey="reports-compliance">
      <PageHeader
        eyebrow="Reports"
        title="Compliance Report"
        subtitle="Driver licences and vehicle documents — status over the next 120 days"
        actions={<ReportActions build={buildExport} refreshing={refreshing} lastUpdated={lastUpdated} onRefresh={refresh} />}
      />
        {error && (
          <StaleData error={error} onRetry={refresh} retrying={refreshing} lastUpdated={lastUpdated} />
        )}

      <div style={kpiGrid}>
        <StatCard index={0} label="Tracked items" value={c.total} icon={ShieldCheck} tone="accent" />
        <StatCard index={1} label="Expired" value={c.critical} icon={ShieldX} tone={c.critical ? "danger" : "ok"} />
        <StatCard index={2} label="Expiring soon" value={c.warning} icon={ShieldAlert} tone={c.warning ? "warn" : "ok"} />
        <StatCard index={3} label="Valid" value={c.info} icon={ShieldCheck} tone="ok" />
      </div>

      <div style={chartsGrid}>
        <ChartCard title="By priority"><Bar rows={c.priorityRows} /></ChartCard>
        <ChartCard title="By record type"><Bar rows={c.entityRows} /></ChartCard>
        <ChartCard title="By document"><Bar rows={c.docRows} tone="var(--warn)" /></ChartCard>

        <ChartCard title="Soonest expirations" wide>
          <div style={{ overflowX: "auto" }}>
            <table className="ops-table">
              <thead>
                <tr><th>Record</th><th>Type</th><th>Document</th><th>Expiry</th><th>Days</th><th>Priority</th></tr>
              </thead>
              <tbody>
                {c.upcoming.length === 0 ? (
                  <tr><td colSpan={6}><div className="ops-empty"><div className="ops-empty-desc">Nothing expiring in the window</div></div></td></tr>
                ) : c.upcoming.map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 600, color: "var(--text)" }}>{a.entityName}</td>
                    <td>{a.entity}</td>
                    <td>{docLabel(a.type)}</td>
                    <td>{formatDate(a.expiryDate)}</td>
                    <td className="tk-mono" style={{ color: a.daysToExpiry < 0 ? "var(--danger)" : a.daysToExpiry <= 30 ? "var(--warn)" : "var(--text-2)" }}>
                      {a.daysToExpiry < 0 ? `${Math.abs(a.daysToExpiry)} overdue` : a.daysToExpiry}
                    </td>
                    <td>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                        color: a.priority === "CRITICAL" ? "var(--danger)" : a.priority === "WARNING" ? "var(--warn)" : "var(--text-2)",
                        background: "var(--surface-sunk)",
                      }}>{a.priority}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
    </AppShell>
  );
}
