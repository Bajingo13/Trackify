import { useState } from "react";
import { motion } from "motion/react";
import { RefreshCw, FileDown } from "lucide-react";
import { Card } from "../../components/ui";
import { relativeTime } from "../../hooks/useAutoRefresh";
import { exportLockedWorkbook } from "../../utils/exportExcel";

export const titleCase = (s = "") =>
  String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Horizontal bar list. rows: [{ key, label, value, tone? }] */
export function Bar({ rows, tone = "var(--accent)" }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r) => (
        <div key={r.key} style={{ display: "grid", gridTemplateColumns: "150px 1fr 52px", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: "var(--fs-12)", color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <div style={{ height: 8, borderRadius: 999, background: "var(--surface-sunk)", overflow: "hidden" }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(r.value / max) * 100}%` }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              style={{ height: "100%", background: r.tone || tone, borderRadius: 999 }}
            />
          </div>
          <span className="tk-mono" style={{ fontSize: "var(--fs-12)", color: "var(--text)", textAlign: "right" }}>{r.display ?? r.value}</span>
        </div>
      ))}
      {rows.length === 0 && <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)" }}>No data in range</span>}
    </div>
  );
}

export function RefreshButton({ refreshing, lastUpdated, onClick }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: "var(--fs-11)", color: "var(--text-3)" }}>
        {refreshing ? "Refreshing…" : lastUpdated ? `Updated ${relativeTime(lastUpdated)}` : ""}
      </span>
      <button className="ops-btn ops-btn-secondary" onClick={onClick} disabled={refreshing} style={{ padding: "6px 12px", fontSize: 12 }}>
        <RefreshCw size={13} style={refreshing ? { animation: "spin 0.8s linear infinite" } : undefined} /> Refresh
      </button>
    </div>
  );
}

/**
 * "Export to Excel" — `build()` returns the workbook spec (see exportExcel.js).
 * The produced .xlsx is sheet-protected: it opens for reading but cannot be edited.
 */
export function ExportButton({ build, disabled }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  async function go() {
    setBusy(true);
    setErr(false);
    try {
      await exportLockedWorkbook(build());
    } catch (e) {
      console.error("[export] failed", e);
      setErr(true);
      setTimeout(() => setErr(false), 4000);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      className="ops-btn ops-btn-secondary"
      onClick={go}
      disabled={disabled || busy}
      title="Download a locked (read-only) Excel file"
      style={{ padding: "6px 12px", fontSize: 12, color: err ? "var(--danger)" : undefined }}
    >
      <FileDown size={13} /> {busy ? "Exporting…" : err ? "Export failed" : "Export to Excel"}
    </button>
  );
}

/** Header/toolbar row combining Export + Refresh for a report page. */
export function ReportActions({ build, refreshing, lastUpdated, onRefresh }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <ExportButton build={build} />
      <RefreshButton refreshing={refreshing} lastUpdated={lastUpdated} onClick={onRefresh} />
    </div>
  );
}

/** Convert Bar rows [{label,value,display}] to a sheet: [[h1,h2], [label, display|value], ...]. */
export function barSheet(name, headers, rows) {
  return { name, rows: [headers, ...rows.map((r) => [r.label, r.display ?? r.value])] };
}

const dateInput = {
  padding: "6px 8px", border: "1px solid var(--line-strong)", borderRadius: "var(--r-sm)",
  background: "var(--surface)", fontSize: "var(--fs-12)", color: "var(--text)",
};

export function RangeCard({ from, to, setFrom, setTo, summary }) {
  return (
    <Card style={{ marginBottom: "var(--s-4)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--text-2)" }}>Date range</span>
      <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={dateInput} />
      <span>–</span>
      <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={dateInput} />
      {(from || to) && (
        <button className="ops-btn ops-btn-ghost" style={{ fontSize: 12 }} onClick={() => { setFrom(""); setTo(""); }}>Clear</button>
      )}
      <span style={{ marginLeft: "auto", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>{summary}</span>
    </Card>
  );
}

export function makeInRange(from, to) {
  return (d) => {
    if (!d) return false;
    const x = new Date(d);
    if (from && x < new Date(from)) return false;
    if (to && x > new Date(`${to}T23:59:59`)) return false;
    return true;
  };
}

export const ChartCard = ({ title, children, wide, footer }) => (
  <Card style={wide ? { gridColumn: "1 / -1" } : undefined}>
    <h3 style={{ margin: "0 0 var(--s-4)", fontSize: "var(--fs-14)", fontWeight: 700 }}>{title}</h3>
    {children}
    {footer && <div style={{ marginTop: "var(--s-3)", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>{footer}</div>}
  </Card>
);

export const chartsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: "var(--s-4)",
};
export const kpiGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "var(--s-3)",
  marginBottom: "var(--s-5)",
};
