import { useState, useEffect, useCallback } from "react";
import AppShell from "../../components/layout/AppShell";
import { Search, ArrowRightLeft, Check, X } from "lucide-react";
import Pagination from "../../components/shared/Pagination";
import { useToast } from "../../components/shared/Toast";
import { Can } from "../../auth/permissions";
import { getAllStockMovements, getStockMovementStats, receiveMovement, cancelMovement } from "../../services/warehouse/inventoryService";
import "../../styles/operations.css";

const TYPE_COLORS = { Transfer: { bg: "#EEF4FF", text: "#2455D6" }, Issue: { bg: "#FEF3C7", text: "#92400E" }, Receiving: { bg: "#DCFCE7", text: "#15803D" }, Adjustment: { bg: "#F3E8FF", text: "#7C3AED" }, Return: { bg: "#FEF2F2", text: "#B91C1C" } };
const STATUS_COLORS = { Completed: { bg: "#DCFCE7", text: "#15803D" }, "In Transit": { bg: "#FEF3C7", text: "#92400E" }, Pending: { bg: "#F1F5F9", text: "#94A3BD" } };

export default function StockMovementsPage() {
  const [allMovements, setAllMovements] = useState([]);
  const [stats, setStats] = useState({ total: 0, completed: 0, inTransit: 0, pending: 0 });
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(null);
  const perPage = 10;
  const { addToast } = useToast();

  const load = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([
        getAllStockMovements({ search, movementType: typeFilter, status: statusFilter }),
        getStockMovementStats(),
      ]);
      setAllMovements(m);
      setStats(s);
    } catch { /* keep */ }
  }, [search, typeFilter, statusFilter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, typeFilter, statusFilter]);

  async function act(id, fn, ok) {
    setBusy(id);
    try { const r = await fn(id); addToast(r?.message || ok, "success"); load(); }
    catch (e) { addToast(e.message || "Action failed", "error"); }
    finally { setBusy(null); }
  }

  const total = allMovements.length;
  const totalPages = Math.ceil(total / perPage);
  const movements = allMovements.slice((page - 1) * perPage, page * perPage);

  const inputStyle = { padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, background: "var(--surface-2)", color: "var(--text)" };

  return (
    <AppShell>
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left"><h1 className="ops-title">Stock Movements</h1><p className="ops-subtitle">Track all inventory movements and transfers</p></div>
        </div>
        <div className="ops-stats-bar">
          {[
            { label: "Total Movements", count: stats.total, filter: "" }, { label: "Completed", count: stats.completed, filter: "Completed" },
            { label: "In Transit", count: stats.inTransit, filter: "In Transit" }, { label: "Pending", count: stats.pending, filter: "Pending" },
          ].map((s) => (
            <button key={s.label} type="button" className={"ops-stat-pill" + (s.filter !== undefined && statusFilter === s.filter ? " ops-stat-pill-active" : "")}
              onClick={s.filter === undefined ? undefined : () => setStatusFilter((v) => (v === s.filter ? "" : s.filter))}
              aria-pressed={s.filter === undefined ? undefined : statusFilter === s.filter}
              style={{ cursor: s.filter === undefined ? "default" : "pointer", font: "inherit", textAlign: "left" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>{s.label}</span>
              <span className="ops-stat-count">{s.count}</span>
            </button>
          ))}
        </div>
        <div className="ops-card">
          <div className="ops-card-header" style={{ justifyContent: "space-between" }}>
            <div className="ops-search"><Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} /><input type="text" placeholder="Search movements..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ ...inputStyle, minWidth: 120 }}>
                <option value="">All Types</option>
                {["Transfer", "Issue", "Receiving", "Adjustment", "Return"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, minWidth: 120 }}>
                <option value="">All Statuses</option>
                {["Completed", "In Transit", "Pending"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="ops-table-wrapper">
            <table className="ops-table">
              <thead><tr><th>Reference</th><th>Item</th><th>Type</th><th>Qty</th><th>From</th><th>To</th><th>Date</th><th>Status</th><th style={{ width: 90 }}>Actions</th></tr></thead>
              <tbody>
                {movements.length === 0 ? (
                  <tr><td colSpan={9}><div className="ops-empty"><ArrowRightLeft size={32} style={{ opacity: 0.3 }} /><div className="ops-empty-title">No movements found</div><div className="ops-empty-desc">{search || typeFilter || statusFilter ? "Try adjusting your filters" : "No stock movements recorded"}</div></div></td></tr>
                ) : movements.map((m) => {
                  const tc = TYPE_COLORS[m.movementType] || TYPE_COLORS.Transfer;
                  const sc = STATUS_COLORS[m.status] || STATUS_COLORS.Pending;
                  return (
                    <tr key={m.id}>
                      <td style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-blue)" }}>{m.referenceNo}</td>
                      <td><div style={{ fontSize: 13, fontWeight: 600 }}>{m.itemName}</div></td>
                      <td><span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: tc.bg, color: tc.text }}>{m.movementType}</span></td>
                      <td style={{ fontSize: 13, fontWeight: 600 }}>{m.quantity}</td>
                      <td style={{ fontSize: 12 }}>{m.sourceLocationName}</td>
                      <td style={{ fontSize: 12 }}>{m.destinationLocationName}</td>
                      <td style={{ fontSize: 13 }}>{m.date ? new Date(m.date).toLocaleDateString() : "—"}</td>
                      <td><span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.text }}>{m.status}</span></td>
                      <td>
                        {m.status === "In Transit" ? (
                          <Can permission="stockmovement.manage" fallback={<span style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>—</span>}>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px", color: "#15803D" }} title="Mark received" disabled={busy === m.id} onClick={() => act(m.id, receiveMovement, "Marked received")}><Check size={13} /></button>
                              <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px", color: "#EF4444" }} title="Cancel (reverse stock)" disabled={busy === m.id} onClick={() => act(m.id, cancelMovement, "Cancelled")}><X size={13} /></button>
                            </div>
                          </Can>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>—</span>
                        )}
                      </td>
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
