import LoadFailure, { StaleData } from "../../components/shared/LoadFailure";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Route as RouteIcon, TriangleAlert, Timer, CircleCheck, RefreshCw } from "lucide-react";
import AppShell from "../../components/layout/AppShell";
import { Card, PageHeader, StatCard } from "../../components/ui";
import { getOperationsReport } from "../../services/reports/reportsService";
import { exceptionTypes } from "../../services/operations/exceptionService";
import { usePermissions } from "../../auth/permissions";
import { useAutoRefresh, relativeTime } from "../../hooks/useAutoRefresh";
import { todayInput } from "../../utils/date";
import { ExportButton, barSheet } from "./reportKit";

/**
 * Operations report.
 *
 * Counted by the database. This page used to pull two thousand trips and every
 * exception into the browser on each load and total them here; it now asks for
 * the figures themselves, and the date range is applied in SQL rather than by
 * discarding most of what was just downloaded.
 */
const STATUS_ORDER = [
  "draft", "for_validation", "for_approval", "approved", "assigned",
  "released", "in_transit", "delivered", "operationally_closed", "rejected", "cancelled",
];

/* The four priorities the trip ticket actually carries, worst first. */
const PRIORITY_TONE = {
  critical: "var(--danger)",
  high: "var(--warn)",
  normal: "var(--accent)",
  low: "var(--text-3)",
};
const PRIORITY_ORDER = ["critical", "high", "normal", "low"];

const SEVERITY_TONE = {
  critical: "var(--danger)",
  warning: "var(--warn)",
  info: "var(--accent)",
};

const EMPTY = {
  trips: {
    total: 0, onTimePct: null, onTimeJudged: 0, avgDurationHours: null,
    statusRows: [], priorityRows: [], topRoutes: [], topBarangays: [],
  },
  exceptions: {
    total: 0, open: 0, severityRows: [], statusRows: [], typeRows: [],
    avgResolutionHours: null,
  },
};

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

/** Puts the server's rows into the order the board reads them in. */
function ordered(rows, order) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const known = order.filter((k) => byKey.has(k)).map((k) => byKey.get(k));
  const rest = rows.filter((r) => !order.includes(r.key));
  return [...known, ...rest];
}

const hours = (h) => (h != null ? `${h.toFixed(1)} h` : "—");

export default function OperationsReportsPage() {
  const { can } = usePermissions();
  const [data, setData] = useState(EMPTY);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = async () => setData(await getOperationsReport({ from, to }));
  const { refreshing, lastUpdated, refresh, error, loaded } = useAutoRefresh(load, 60000);

  // The range is applied in SQL now, so changing it has to ask again.
  useEffect(() => { refresh(); }, [from, to, refresh]);

  const t = data.trips || EMPTY.trips;
  const ex = data.exceptions || EMPTY.exceptions;
  const showExceptions = can("exception.read");

  const countOf = (key) => t.statusRows.find((r) => r.key === key)?.value || 0;
  const closed = countOf("operationally_closed");
  const inTransit = countOf("in_transit");
  const rejected = countOf("rejected") + countOf("cancelled");

  const statusRows = ordered(t.statusRows, STATUS_ORDER);
  const priorityRows = ordered(t.priorityRows, PRIORITY_ORDER)
    .map((r) => ({ ...r, tone: PRIORITY_TONE[r.key] }));
  const severityRows = ex.severityRows.map((r) => ({ ...r, tone: SEVERITY_TONE[r.key] }));

  // The server title-cases an unknown key, which turns gps_offline into "Gps
  // Offline". The operations vocabulary already has proper names for these, so
  // prefer it and fall back to the server's label for a type it has not met.
  const exceptionTypeRows = ex.typeRows.map((r) => ({
    ...r,
    label: exceptionTypes[r.key] || r.label,
  }));

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
        ["Completed", closed],
        ["In transit", inTransit],
        ["Rejected / cancelled", rejected],
        ["On-time %", t.onTimePct ?? "n/a"],
        ["On-time sample size", t.onTimeJudged],
        ["Avg planned duration (h)", t.avgDurationHours != null ? t.avgDurationHours.toFixed(1) : "n/a"],
        ["Exceptions total", ex.total],
        ["Exceptions open", ex.open],
        ["Avg time to resolve (h)", ex.avgResolutionHours != null ? ex.avgResolutionHours.toFixed(1) : "n/a"],
      ] },
      barSheet("Trips by status", ["Status", "Count"], statusRows),
      barSheet("Top routes", ["Route", "Trips"], t.topRoutes),
      barSheet("Top barangays delivered to", ["Barangay", "Trips"], t.topBarangays || []),
      barSheet("Trips by priority", ["Priority", "Count"], priorityRows),
      barSheet("Exceptions by severity", ["Severity", "Count"], severityRows),
      barSheet("Exceptions by type", ["Type", "Count"], exceptionTypeRows),
    ],
  });

  /*
   * Nothing has ever arrived and the last attempt failed. Rendering the page
   * below would show this screen's empty defaults — zeros that read as real
   * figures — so it says plainly that nothing was loaded.
   */
  if (!loaded && error) {
    return (
      <AppShell pageKey="reports-operations">
        <PageHeader eyebrow="Reports" title="Operations Report" />
        <LoadFailure error={error} onRetry={refresh} retrying={refreshing} what="the operations report" />
      </AppShell>
    );
  }

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

        {/* Figures are on screen but the newest refresh failed: keep them,
            and say how old they are rather than implying they are current. */}
        {error && (
          <StaleData error={error} onRetry={refresh} retrying={refreshing} lastUpdated={lastUpdated} />
        )}

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
          {t.total} trips{showExceptions ? ` · ${ex.total} exceptions` : ""}
        </span>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--s-3)", marginBottom: "var(--s-5)" }}>
        <StatCard index={0} label="Trips" value={t.total} icon={RouteIcon} tone="accent" />
        <StatCard index={1} label="Completed" value={closed} icon={CircleCheck} tone="ok" />
        <StatCard index={2} label="On-time %" value={t.onTimePct ?? 0} icon={Timer} tone={t.onTimePct != null && t.onTimePct < 80 ? "warn" : "ok"} hint={t.onTimeJudged ? `of ${t.onTimeJudged} delivered` : "no completed trips"} />
        {showExceptions && (
          <StatCard index={3} label="Open exceptions" value={ex.open} icon={TriangleAlert} tone={ex.open ? "danger" : "ok"} hint={`${ex.total} total`} />
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--s-4)" }}>
        <Card>
          <h3 style={{ margin: "0 0 var(--s-4)", fontSize: "var(--fs-14)", fontWeight: 700 }}>Trips by status</h3>
          <Bar rows={statusRows} />
        </Card>
        <Card>
          <h3 style={{ margin: "0 0 var(--s-4)", fontSize: "var(--fs-14)", fontWeight: 700 }}>Top routes</h3>
          <Bar rows={t.topRoutes} tone="var(--st-transit)" />
        </Card>
        <Card>
          <h3 style={{ margin: "0 0 var(--s-4)", fontSize: "var(--fs-14)", fontWeight: 700 }}>Top barangays delivered to</h3>
          <Bar rows={t.topBarangays || []} tone="var(--st-transit)" />
          <div style={{ marginTop: "var(--s-3)", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
            Only trips whose destination was placed on the map carry a barangay.
          </div>
        </Card>
        <Card>
          <h3 style={{ margin: "0 0 var(--s-4)", fontSize: "var(--fs-14)", fontWeight: 700 }}>Trips by priority</h3>
          <Bar rows={priorityRows} />
          <div style={{ marginTop: "var(--s-3)", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
            Avg planned duration: <b className="tk-mono" style={{ color: "var(--text)" }}>{hours(t.avgDurationHours)}</b>
          </div>
        </Card>
        {showExceptions && (
          <Card>
            <h3 style={{ margin: "0 0 var(--s-4)", fontSize: "var(--fs-14)", fontWeight: 700 }}>Exceptions by severity</h3>
            <Bar rows={severityRows} />
            <div style={{ marginTop: "var(--s-3)", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
              Avg time to resolve: <b className="tk-mono" style={{ color: "var(--text)" }}>{hours(ex.avgResolutionHours)}</b>
            </div>
          </Card>
        )}
        {showExceptions && (
          <Card style={{ gridColumn: "1 / -1" }}>
            <h3 style={{ margin: "0 0 var(--s-4)", fontSize: "var(--fs-14)", fontWeight: 700 }}>Exceptions by type</h3>
            <Bar rows={exceptionTypeRows} tone="var(--warn)" />
          </Card>
        )}
      </div>
    </AppShell>
  );
}
