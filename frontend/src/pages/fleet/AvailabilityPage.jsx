import LoadFailure, { StaleData } from "../../components/shared/LoadFailure";
import { useState, useMemo, useEffect, useCallback } from "react";
import AppShell from "../../components/layout/AppShell";
import { Search, Truck, RefreshCw } from "lucide-react";
import Pagination from "../../components/shared/Pagination";
import OpsStatCard from "../../components/operations/OpsStatCard";
import { getAvailabilityData, getVehicleStats } from "../../services/fleet/vehicleService";
import { useAutoRefresh, relativeTime } from "../../hooks/useAutoRefresh";
import StateBadge from "../../components/shared/StateBadge";
import "../../styles/operations.css";

const STATUS_COLORS = {
  Available: { bg: "#DCFCE7", text: "#15803D" },
  "On Trip": { bg: "#FEF3C7", text: "#92400E" },
  Maintenance: { bg: "#FEF2F2", text: "#B91C1C" },
  Retired: { bg: "#F1F5F9", text: "#94A3BD" },
};
const STATUS_FILTERS = ["Available", "On Trip", "Maintenance"];

export default function AvailabilityPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [vehicles, setVehicles] = useState([]);
  const [stats, setStats] = useState({ total: 0, available: 0, onTrip: 0, maintenance: 0, unavailable: 0 });
  const perPage = 10;

  const load = useCallback(async () => {
    const [v, s] = await Promise.all([getAvailabilityData(), getVehicleStats()]);
    setVehicles(v);
    setStats(s);
  }, []);
  const { refreshing, lastUpdated, refresh, error, loaded } = useAutoRefresh(load, 25000);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return vehicles.filter((v) => {
      if (statusFilter && v.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (v.plateNo || "").toLowerCase().includes(q) ||
        (v.type || "").toLowerCase().includes(q) ||
        (v.brand || "").toLowerCase().includes(q) ||
        (v.currentLocation || "").toLowerCase().includes(q)
      );
    });
  }, [vehicles, search, statusFilter]);

  const total = filtered.length;
  const totalPages = Math.ceil(total / perPage) || 1;
  const paged = filtered.slice((page - 1) * perPage, page * perPage);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const inputStyle = { padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, background: "var(--surface-2)", color: "var(--text)" };

  /*
   * Nothing has ever arrived and the last attempt failed. Rendering the
   * page below would show this screen's empty defaults, which read as
   * real figures, so it says plainly that nothing was loaded.
   */
  if (!loaded && error) {
    return (
      <AppShell>
        <LoadFailure error={error} onRetry={refresh} retrying={refreshing} what="fleet availability" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="ops-container">
        {error && (
          <StaleData error={error} onRetry={refresh} retrying={refreshing} lastUpdated={lastUpdated} />
        )}

        <div className="ops-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div className="ops-header-left">
            <h1 className="ops-title">Fleet Availability</h1>
            <p className="ops-subtitle">Live view of which vehicles are free, on a trip, or in maintenance</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>
              {refreshing ? "Refreshing…" : lastUpdated ? `Updated ${relativeTime(lastUpdated)}` : ""}
              <span style={{ marginLeft: 6, color: "#22C55E" }}>● auto</span>
            </span>
            <button className="ops-btn ops-btn-secondary" onClick={refresh} disabled={refreshing} style={{ padding: "6px 12px", fontSize: 12 }}>
              <RefreshCw size={13} style={refreshing ? { animation: "spin 0.8s linear infinite" } : undefined} /> Refresh
            </button>
          </div>
        </div>

        <div className="ops-stats-bar">
          <OpsStatCard label="Total Vehicles" count={stats.total} active={!statusFilter}
            onClick={() => setStatusFilter("")} />
          <OpsStatCard label="Available" count={stats.available} active={statusFilter === "Available"}
            onClick={() => setStatusFilter((v) => (v === "Available" ? "" : "Available"))} />
          <OpsStatCard label="On Trip" count={stats.onTrip} active={statusFilter === "On Trip"}
            onClick={() => setStatusFilter((v) => (v === "On Trip" ? "" : "On Trip"))} />
          <OpsStatCard label="Maintenance" count={stats.maintenance} active={statusFilter === "Maintenance"}
            onClick={() => setStatusFilter((v) => (v === "Maintenance" ? "" : "Maintenance"))} />
          <OpsStatCard label="Retired" count={stats.unavailable} active={statusFilter === "Retired"}
            onClick={() => setStatusFilter((v) => (v === "Retired" ? "" : "Retired"))} />
        </div>

        <div className="ops-card">
          <div className="ops-card-header" style={{ justifyContent: "space-between" }}>
            <div className="ops-search"><Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} /><input type="text" placeholder="Search vehicles..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, minWidth: 130 }}>
              <option value="">All Statuses</option>
              {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="ops-table-wrapper">
            <table className="ops-table">
              <thead><tr><th>Vehicle</th><th>Plate No</th><th>Type</th><th>Home Branch</th><th>Odometer</th><th>Status</th><th>Current Trip</th></tr></thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr><td colSpan={7}><div className="ops-empty"><Truck size={32} style={{ opacity: 0.3 }} /><div className="ops-empty-title">No vehicles found</div><div className="ops-empty-desc">{search || statusFilter ? "Try adjusting your filters" : "No vehicles available"}</div></div></td></tr>
                ) : paged.map((v) => {
                  return (
                    <tr key={v.id}>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{[v.brand, v.model].filter(Boolean).join(" ") || "—"}</td>
                      <td style={{ fontSize: 13 }}>{v.plateNo}</td>
                      <td style={{ fontSize: 13 }}>{v.type}</td>
                      <td style={{ fontSize: 13 }}>{v.currentLocation}</td>
                      <td style={{ fontSize: 13 }}>{v.odometerReading?.toLocaleString()} km</td>
                      <td><StateBadge status={v.status} /></td>
                      <td style={{ fontSize: 13 }}>{v.currentAssignment || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} perPage={perPage} onPageChange={setPage} />
        </div>
      </div>
    </AppShell>
  );
}
