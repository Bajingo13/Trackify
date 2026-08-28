import { useState, useEffect } from "react";
import { Search, Truck } from "lucide-react";
import TopNav from "../../components/dashboard/TopNav";
import Pagination from "../../components/shared/Pagination";
import { getAvailabilityData, getVehicleStats } from "../../services/fleet/vehicleService";
import "../../styles/operations.css";

const STATUS_COLORS = {
  Available: { bg: "#DCFCE7", text: "#15803D" }, Assigned: { bg: "#EEF4FF", text: "#2455D6" },
  "On Trip": { bg: "#FEF3C7", text: "#92400E" }, Reserved: { bg: "#F3E8FF", text: "#7C3AED" },
  Maintenance: { bg: "#FEF2F2", text: "#B91C1C" }, Unavailable: { bg: "#F1F5F9", text: "#94A3BD" },
};

export default function AvailabilityPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [vehicles, setVehicles] = useState([]);
  const [stats, setStats] = useState({ total: 0, available: 0, assigned: 0, onTrip: 0, reserved: 0, maintenance: 0, unavailable: 0 });

  const perPage = 10;

  useEffect(() => {
    setVehicles(getAvailabilityData());
    setStats(getVehicleStats());
  }, []);

  const filtered = vehicles.filter((v) => {
    if (statusFilter && v.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return v.plateNo.toLowerCase().includes(q) || v.type.toLowerCase().includes(q) || v.brand.toLowerCase().includes(q) || v.currentLocation.toLowerCase().includes(q);
    }
    return true;
  });

  const total = filtered.length;
  const totalPages = Math.ceil(total / perPage);
  const paged = filtered.slice((page - 1) * perPage, page * perPage);

  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const inputStyle = { padding: "8px 12px", border: "1px solid var(--trackify-border)", borderRadius: 8, fontSize: 13, background: "#F8FAFD" };

  return (
    <div className="ops-page">
      <TopNav />
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left"><h1 className="ops-title">Fleet Availability</h1><p className="ops-subtitle">Real-time vehicle availability dashboard</p></div>
        </div>
        <div className="ops-stats-bar">
          {[
            { label: "Total Vehicles", count: stats.total, color: "#071A4A" }, { label: "Available", count: stats.available, color: "#22C55E" },
            { label: "Assigned", count: stats.assigned, color: "#2455D6" }, { label: "On Trip", count: stats.onTrip, color: "#F59E0B" },
            { label: "Reserved", count: stats.reserved, color: "#7C3AED" }, { label: "Maintenance", count: stats.maintenance, color: "#EF4444" },
            { label: "Unavailable", count: stats.unavailable, color: "#94A3BD" },
          ].map((s) => (
            <div key={s.label} className="ops-stat-pill">
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: s.color }} />{s.label}</span>
              <span className="ops-stat-count">{s.count}</span>
            </div>
          ))}
        </div>
        <div className="ops-card">
          <div className="ops-card-header" style={{ justifyContent: "space-between" }}>
            <div className="ops-search"><Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} /><input type="text" placeholder="Search vehicles..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, minWidth: 130 }}>
              <option value="">All Statuses</option>
              {["Available", "Assigned", "On Trip", "Reserved", "Maintenance", "Unavailable"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="ops-table-wrapper">
            <table className="ops-table">
              <thead><tr><th>Vehicle</th><th>Plate No</th><th>Type</th><th>Driver</th><th>Location</th><th>Odometer</th><th>Status</th><th>Assignment</th><th>Next Maintenance</th></tr></thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr><td colSpan={9}><div className="ops-empty"><Truck size={32} style={{ opacity: 0.3 }} /><div className="ops-empty-title">No vehicles found</div><div className="ops-empty-desc">{search || statusFilter ? "Try adjusting your filters" : "No vehicles available"}</div></div></td></tr>
                ) : paged.map((v) => {
                  const c = STATUS_COLORS[v.status] || STATUS_COLORS.Available;
                  return (
                    <tr key={v.id}>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{v.brand} {v.model}</td>
                      <td style={{ fontSize: 13 }}>{v.plateNo}</td>
                      <td style={{ fontSize: 13 }}>{v.type}</td>
                      <td style={{ fontSize: 13 }}>{v.assignedDriverId ? `DRV-${String(v.assignedDriverId).padStart(4, "0")}` : "—"}</td>
                      <td style={{ fontSize: 13 }}>{v.currentLocation}</td>
                      <td style={{ fontSize: 13 }}>{v.odometerReading?.toLocaleString()} km</td>
                      <td><span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: c.bg, color: c.text }}>{v.status}</span></td>
                      <td style={{ fontSize: 13 }}>{v.currentAssignment || "—"}</td>
                      <td style={{ fontSize: 13 }}>{v.nextMaintenance || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} perPage={perPage} onPageChange={setPage} />
        </div>
      </div>
    </div>
  );
}
