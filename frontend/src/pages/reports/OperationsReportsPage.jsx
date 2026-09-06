import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Route as RouteIcon, TriangleAlert, Timer, CircleCheck, RefreshCw } from "lucide-react";
import AppShell from "../../components/layout/AppShell";
import { Card, PageHeader, StatCard } from "../../components/ui";
import { getAllTrips } from "../../services/operations/tripService";
import { getAllExceptions, exceptionTypes } from "../../services/operations/exceptionService";
import { usePermissions } from "../../auth/permissions";
import { useAutoRefresh, relativeTime } from "../../hooks/useAutoRefresh";
import { todayInput } from "../../utils/date";
import { ExportButton, barSheet } from "./reportKit";

const STATUS_ORDER = [
  "draft", "for_validation", "for_approval", "approved", "assigned",
  "released", "in_transit", "delivered", "operationally_closed", "rejected", "cancelled",
];
const label = (s) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function Bar({ rows, tone = "var(--accent)" }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r) => (
        <div key={r.key} style={{ display: "grid", gridTemplateColumns: "150px 1fr 44px", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: "var(--fs-12)", color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <div style={{ height: 8, borderRadius: 999, background: "var(--surface-sunk)", overflow: "hidden" }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(r.value / max) * 100}%` }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              style={{ height: "100%", background: r.tone || tone, borderRadius: 999 }}
            />
          </div>
          <span className="tk-mono" style={{ fontSize: "var(--fs-12)", color: "var(--text)", textAlign: "right" }}>{r.value}</span>
        </div>
      ))}
      {rows.length === 0 && <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)" }}>No data in range</span>}
    </div>
  );
}

export default function OperationsReportsPage() {
  const { can } = usePermissions();
  const [trips, setTrips] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = async () => {
    const [t, e] = await Promise.all([
      getAllTrips({ limit: 2000 }),
      can("exception.read") ? getAllExceptions() : Promise.resolve([]),
    ]);
    setTrips(t);
    setExceptions(e);
  };
  const { refreshing, lastUpdated, refresh } = useAutoRefresh(load, 60000);

  const inRange = (d) => {
    if (!d) return false;
    const x = new Date(d);
    if (from && x < new Date(from)) return false;
    if (to && x > new Date(`${to}T23:59:59`)) return false;
    return true;
  };

  const t = useMemo(() => {
    const rows = (from || to)
      ? trips.filter((x) => inRange(x.scheduledDeparture || x.createdAt))
      : trips;
    const byStatus = {};
    rows.forEach((x) => { byStatus[x.status] = (byStatus[x.status] || 0) + 1; });

    const withArr = rows.filter((x) => x.actualArrival && x.scheduledArrival);
    const onTime = withArr.filter((x) => new Date(x.actualArrival) <= new Date(x.scheduledArrival)).length;

    const durations = rows
      .filter((x) => x.scheduledDeparture && x.scheduledArrival)
      .map((x) => (new Date(x.scheduledArrival) - new Date(x.scheduledDeparture)) / 36e5);
    const avgDur = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    const routeMap = {};
    rows.forEach((x) => {
      const k = `${x.origin} → ${x.destination}`;
      routeMap[k] = (routeMap[k] || 0) + 1;
    });
    const topRoutes = Object.entries(routeMap)
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([k, v]) => ({ key: k, label: k, value: v }));

    const prio = { urgent: 0, high: 0, normal: 0 };
    rows.forEach((x) => { prio[x.priority || "normal"] = (prio[x.priority || "normal"] || 0) + 1; });

    return {
      total: rows.length,
      closed: byStatus.operationally_closed || 0,
      inTransit: byStatus.in_transit || 0,
      rejected: (byStatus.rejected || 0) + (byStatus.cancelled || 0),
      onTimePct: withArr.length ? Math.round((onTime / withArr.length) * 100) : null,
      onTimeBase: withArr.length,
      avgDur,
      statusRows: STATUS_ORDER.filter((s) => byStatus[s]).map((s) => ({ key: s, label: label(s), value: byStatus[s] })),
      topRoutes,
      prioRows: [
        { key: "urgent", label: "Urgent", value: prio.urgent, tone: "var(--danger)" },
        { key: "high", label: "High", value: prio.high, tone: "var(--warn)" },
        { key: "normal", label: "Normal", value: prio.normal, tone: "var(--accent)" },
      ],
    };
  }, [trips, from, to]);

  const ex = useMemo(() => {
    const rows = (from || to) ? exceptions.filter((x) => inRange(x.detectedAt)) : exceptions;
    const bySev = { critical: 0, warning: 0, info: 0 };
    const byType = {};
    let resolvedDurations = [];
    rows.forEach((x) => {
      bySev[x.severity] = (bySev[x.severity] || 0) + 1;
      byType[x.type] = (byType[x.type] || 0) + 1;
      if (x.resolvedAt && x.detectedAt) {
        resolvedDurations.push((new Date(x.resolvedAt) - new Date(x.detectedAt)) / 36e5);
      }
    });
    const open = rows.filter((x) => x.status !== "resolved").length;
    const avgRes = resolvedDurations.length
      ? resolvedDurations.reduce((a, b) => a + b, 0) / resolvedDurations.length : 0;
    return {
      total: rows.length, open,
      sevRows: [
        { key: "critical", label: "Critical", value: bySev.critical, tone: "var(--danger)" },
        { key: "warning", label: "Warning", value: bySev.warning, tone: "var(--warn)" },
        { key: "info", label: "Info", value: bySev.info, tone: "var(--accent)" },
      ],
      typeRows: Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([k, v]) => ({ key: k, label: exceptionTypes[k] || k, value: v })),
      avgRes,
    };
  }, [exceptions, from, to]);

  const buildExport = () => ({
    filename: `Operations Report ${todayInput()}`,
    title: "AstreaBlue Trackify — Operations Report",
    meta: [
      ["Generated", new Date().toLocaleString()],
      ["Date range", (from || to) ? `${from || "start"} to ${to || "today"}` : "All time"],
    ],
    sheets: [
      { name: "Summary", rows: [
        ["Metric", "Value"],
        ["Trips", t.total],
        ["Completed", t.closed],
        ["In transit", t.inTransit],
        ["Rejected / cancelled", t.rejected],
        ["On-time %", t.onTimePct ?? "n/a"],
        ["On-time sample size", t.onTimeBase],
        ["Avg planned duration (h)", t.avgDur ? t.avgDur.toFixed(1) : "n/a"],
        ["Exceptions total", ex.total],
        ["Exceptions open", ex.open],
        ["Avg time to resolve (h)", ex.avgRes ? ex.avgRes.toFixed(1) : "n/a"],
      ] },
      barSheet("Trips by status", ["Status", "Count"], t.statusRows),
      barSheet("Top routes", ["Route", "Trips"], t.topRoutes),
      barSheet("Trips by priority", ["Priority", "Count"], t.prioRows),
      barSheet("Exceptions by severity", ["Severity", "Count"], ex.sevRows),
      barSheet("Exceptions by type", ["Type", "Count"], ex.typeRows),
    ],
  });

  return (
    <AppShell pageKey="reports-operations">
      <PageHeader
        eyebrow="Reports"
        title="Operations Report"
        subtitle="Trip throughput, on-time performance and exception trends"
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <ExportButton build={buildExport} />
            <span style={{ fontSize: "var(--fs-11)", color: "var(--text-3)" }}>
              {refreshing ? "Refreshing…" : lastUpdated ? `Updated ${relativeTime(lastUpdated)}` : ""}
            </span>
            <button className="ops-btn ops-btn-secondary" onClick={refresh} disabled={refreshing} style={{ padding: "6px 12px", fontSize: 12 }}>
              <RefreshCw size={13} style={refreshing ? { animation: "spin 0.8s linear infinite" } : undefined} /> Refresh
            </button>
          </div>
        }
      />

      <Card style={{ marginBottom: "var(--s-4)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--text-2)" }}>Date range</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          style={{ padding: "6px 8px", border: "1px solid var(--line-strong)", borderRadius: "var(--r-sm)", background: "var(--surface)", fontSize: "var(--fs-12)", color: "var(--text)" }} />
        <span>–</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
          style={{ padding: "6px 8px", border: "1px solid var(--line-strong)", borderRadius: "var(--r-sm)", background: "var(--surface)", fontSize: "var(--fs-12)", color: "var(--text)" }} />
        {(from || to) && (
          <button className="ops-btn ops-btn-ghost" style={{ fontSize: 12 }} onClick={() => { setFrom(""); setTo(""); }}>Clear</button>
        )}
        <span style={{ marginLeft: "auto", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
          {t.total} trips · {ex.total} exceptions
        </span>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--s-3)", marginBottom: "var(--s-5)" }}>
        <StatCard index={0} label="Trips" value={t.total} icon={RouteIcon} tone="accent" />
        <StatCard index={1} label="Completed" value={t.closed} icon={CircleCheck} tone="ok" />
        <StatCard index={2} label="On-time %" value={t.onTimePct ?? 0} icon={Timer} tone={t.onTimePct != null && t.onTimePct < 80 ? "warn" : "ok"} hint={t.onTimeBase ? `of ${t.onTimeBase} delivered` : "no completed trips"} />
        <StatCard index={3} label="Open exceptions" value={ex.open} icon={TriangleAlert} tone={ex.open ? "danger" : "ok"} hint={`${ex.total} total`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--s-4)" }}>
        <Card>
          <h3 style={{ margin: "0 0 var(--s-4)", fontSize: "var(--fs-14)", fontWeight: 700 }}>Trips by status</h3>
          <Bar rows={t.statusRows} />
        </Card>
        <Card>
          <h3 style={{ margin: "0 0 var(--s-4)", fontSize: "var(--fs-14)", fontWeight: 700 }}>Top routes</h3>
          <Bar rows={t.topRoutes} tone="var(--st-transit)" />
        </Card>
        <Card>
          <h3 style={{ margin: "0 0 var(--s-4)", fontSize: "var(--fs-14)", fontWeight: 700 }}>Trips by priority</h3>
          <Bar rows={t.prioRows} />
          <div style={{ marginTop: "var(--s-3)", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
            Avg planned duration: <b className="tk-mono" style={{ color: "var(--text)" }}>{t.avgDur ? `${t.avgDur.toFixed(1)} h` : "—"}</b>
          </div>
        </Card>
        <Card>
          <h3 style={{ margin: "0 0 var(--s-4)", fontSize: "var(--fs-14)", fontWeight: 700 }}>Exceptions by severity</h3>
          <Bar rows={ex.sevRows} />
          <div style={{ marginTop: "var(--s-3)", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
            Avg time to resolve: <b className="tk-mono" style={{ color: "var(--text)" }}>{ex.avgRes ? `${ex.avgRes.toFixed(1)} h` : "—"}</b>
          </div>
        </Card>
        <Card style={{ gridColumn: "1 / -1" }}>
          <h3 style={{ margin: "0 0 var(--s-4)", fontSize: "var(--fs-14)", fontWeight: 700 }}>Exceptions by type</h3>
          <Bar rows={ex.typeRows} tone="var(--warn)" />
        </Card>
      </div>
    </AppShell>
  );
}
