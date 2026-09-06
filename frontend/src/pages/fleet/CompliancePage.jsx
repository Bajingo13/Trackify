import { useState, useEffect } from "react";
import AppShell from "../../components/layout/AppShell";
import { Search, Shield, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import Pagination from "../../components/shared/Pagination";
import OpsStatCard from "../../components/operations/OpsStatCard";
import { getFilteredComplianceAlerts, getComplianceStats, PRIORITY_LEVELS } from "../../services/fleet/complianceService";
import StateBadge from "../../components/shared/StateBadge";
import "../../styles/operations.css";

const PRIORITY_STYLES = {
  CRITICAL: { tone: "danger", icon: AlertTriangle },
  WARNING: { tone: "warn", icon: AlertTriangle },
  INFO: { tone: "muted", icon: Info },
};

export default function CompliancePage() {
  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState({ total: 0, critical: 0, warning: 0, info: 0 });
  const [priorityFilter, setPriorityFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 10;

  const loadData = async () => {
    try {
      setAlerts(await getFilteredComplianceAlerts({ priority: priorityFilter, module: moduleFilter, search }));
      setStats(await getComplianceStats());
    } catch { /* leave as-is */ }
  };
  useEffect(() => { loadData(); }, [priorityFilter, moduleFilter, search]);
  useEffect(() => { setPage(1); }, [priorityFilter, moduleFilter, search]);

  const total = alerts.length;
  const totalPages = Math.ceil(total / perPage);
  const paged = alerts.slice((page - 1) * perPage, page * perPage);

  const inputStyle = { padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, background: "var(--surface-2)", color: "var(--text)" };

  return (
    <AppShell>
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left"><h1 className="ops-title">Fleet Compliance</h1><p className="ops-subtitle">Monitor compliance alerts and vehicle safety</p></div>
        </div>
        <div className="ops-stats-bar">
          <OpsStatCard label="Total Alerts" count={stats.total} active={!priorityFilter && !moduleFilter}
            onClick={() => { setPriorityFilter(""); setModuleFilter(""); }} />
          <OpsStatCard label="Critical" count={stats.critical} active={priorityFilter === "CRITICAL"}
            onClick={() => setPriorityFilter((v) => (v === "CRITICAL" ? "" : "CRITICAL"))} />
          <OpsStatCard label="Warning" count={stats.warning} active={priorityFilter === "WARNING"}
            onClick={() => setPriorityFilter((v) => (v === "WARNING" ? "" : "WARNING"))} />
          <OpsStatCard label="Info" count={stats.info} active={priorityFilter === "INFO"}
            onClick={() => setPriorityFilter((v) => (v === "INFO" ? "" : "INFO"))} />
        </div>
        <div className="ops-card">
          <div className="ops-card-header" style={{ justifyContent: "space-between" }}>
            <div className="ops-search"><Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} /><input type="text" placeholder="Search alerts..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={{ ...inputStyle, minWidth: 120 }}>
                <option value="">All Priority</option>
                {PRIORITY_LEVELS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} style={{ ...inputStyle, minWidth: 120 }}>
                <option value="">All Modules</option>
                <option value="Fleet">Fleet</option>
                <option value="Maintenance">Maintenance</option>
              </select>
            </div>
          </div>
          <div style={{ padding: "12px 20px" }}>
            {paged.length === 0 ? (
              <div className="ops-empty" style={{ padding: 40 }}>
                <div style={{ width: 56, height: 56, borderRadius: "var(--r-md)", background: "var(--surface-sunk)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12, color: "var(--text-3)" }}>
                  <CheckCircle2 size={28} />
                </div>
                <div className="ops-empty-title">All Clear</div>
                <div className="ops-empty-desc">No compliance alerts at this time</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {paged.map((alert) => {
                  const ps = PRIORITY_STYLES[alert.priority] || PRIORITY_STYLES.INFO;
                  const Icon = ps.icon;
                  return (
                    <div key={alert.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>
                      <div style={{ width: 30, height: 30, borderRadius: "var(--r-xs)", background: "var(--surface-sunk)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--text-3)" }}>
                        <Icon size={14} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <StateBadge status={alert.priority} tone={ps.tone} />
                          <span style={{ fontSize: "var(--fs-11)", color: "var(--text-3)" }}>{alert.entity} · {alert.module}</span>
                        </div>
                        <div style={{ fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text)" }}>{alert.entityName}</div>
                        <div style={{ fontSize: "var(--fs-12)", color: "var(--text-2)", marginTop: 1 }}>{alert.message}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} perPage={perPage} onPageChange={setPage} />
        </div>
      </div>
    </AppShell>
  );
}
