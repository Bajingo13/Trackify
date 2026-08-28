import { useState, useEffect } from "react";
import { Search, Shield, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import TopNav from "../../components/dashboard/TopNav";
import Pagination from "../../components/shared/Pagination";
import OpsStatCard from "../../components/operations/OpsStatCard";
import { getFilteredComplianceAlerts, getComplianceStats, PRIORITY_LEVELS } from "../../services/fleet/complianceService";
import "../../styles/operations.css";

const PRIORITY_STYLES = {
  CRITICAL: { accent: "#EF4444", bg: "#FFF", text: "#B91C1C", muted: "#94A3BD", icon: AlertTriangle, iconColor: "#EF4444", iconBg: "#FEF2F2" },
  WARNING: { accent: "#F59E0B", bg: "#FFF", text: "#92400E", muted: "#94A3BD", icon: AlertTriangle, iconColor: "#F59E0B", iconBg: "#FFFBEB" },
  INFO: { accent: "#2455D6", bg: "#FFF", text: "#1E40AF", muted: "#94A3BD", icon: Info, iconColor: "#2455D6", iconBg: "#EEF4FF" },
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

  const inputStyle = { padding: "8px 12px", border: "1px solid var(--trackify-border)", borderRadius: 8, fontSize: 13, background: "#F8FAFD" };

  return (
    <div className="ops-page">
      <TopNav />
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left"><h1 className="ops-title">Fleet Compliance</h1><p className="ops-subtitle">Monitor compliance alerts and vehicle safety</p></div>
        </div>
        <div className="ops-stats-bar">
          <OpsStatCard label="Total Alerts" count={stats.total} color="#071A4A" bg="#F1F5F9" />
          <OpsStatCard label="Critical" count={stats.critical} color="#B91C1C" bg="#FEF2F2" />
          <OpsStatCard label="Warning" count={stats.warning} color="#92400E" bg="#FEF3C7" />
          <OpsStatCard label="Info" count={stats.info} color="#2455D6" bg="#EEF4FF" />
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
                <div style={{ width: 56, height: 56, borderRadius: 14, background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                  <CheckCircle2 size={28} style={{ color: "#22C55E" }} />
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
                    <div key={alert.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: ps.bg, border: "1px solid #E8ECF1", borderLeft: `3px solid ${ps.accent}`, borderRadius: 8, transition: "all 0.15s ease" }}>
                      <div style={{ width: 30, height: 30, borderRadius: 7, background: ps.iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon size={14} style={{ color: ps.iconColor }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 1 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: ps.text, textTransform: "uppercase", letterSpacing: "0.5px" }}>{alert.priority}</span>
                          <span style={{ fontSize: 9, color: ps.muted }}>·</span>
                          <span style={{ fontSize: 11, color: ps.muted }}>{alert.entity}</span>
                          <span style={{ fontSize: 9, color: ps.muted }}>·</span>
                          <span style={{ fontSize: 11, color: ps.muted }}>{alert.module}</span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#1E293B" }}>{alert.entityName}</div>
                        <div style={{ fontSize: 12, color: "#64748B", marginTop: 1 }}>{alert.message}</div>
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
    </div>
  );
}
