import { useState, useEffect, useCallback } from "react";
import AppShell from "../../components/layout/AppShell";
import { Search, PackageCheck, PackageX, X, History } from "lucide-react";
import Pagination from "../../components/shared/Pagination";
import { useToast } from "../../components/shared/Toast";
import { Can } from "../../auth/permissions";
import {
  getCargoQueue, getCargoEvents, getCargoStats, releaseCargo, returnCargo,
} from "../../services/warehouse/cargoService";
import "../../styles/operations.css";

const inputStyle = { padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, width: "100%", background: "var(--surface-2)", color: "var(--text)" };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 4, display: "block" };
const fmt = (d) => (d ? new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const COND_COLORS = { good: { bg: "#DCFCE7", text: "#15803D" }, damaged: { bg: "#FEF2F2", text: "#B91C1C" }, partial: { bg: "#FEF3C7", text: "#92400E" } };

function CargoForm({ mode, trip, onClose, onSaved }) {
  const { addToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    quantity: trip.cargoQuantity ?? "",
    condition: "good",
    counterparty: mode === "release" ? (trip.driver || "") : "",
    reason: "",
    notes: "",
  });
  const on = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (mode === "return" && !f.reason.trim()) return addToast("A reason is required for a return.", "error");
    setSaving(true);
    try {
      const payload = {
        tripTicketId: trip.tripTicketId,
        quantity: f.quantity ? Number(f.quantity) : undefined,
        condition: f.condition,
        counterparty: f.counterparty || undefined,
        notes: f.notes || undefined,
      };
      if (mode === "return") payload.reason = f.reason;
      const fn = mode === "release" ? releaseCargo : returnCargo;
      const res = await fn(payload);
      addToast(res?.message || "Saved", "success");
      onSaved();
      onClose();
    } catch (err) {
      addToast(err.message || "Failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ops-modal-overlay" onClick={onClose}>
      <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="ops-modal-header">
          <div>
            <h3 className="ops-modal-title">{mode === "release" ? "Release Cargo" : "Log Cargo Return"} — {trip.ticketNo}</h3>
            <span style={{ fontSize: 13, color: "var(--trackify-text-secondary)" }}>{trip.route}</span>
          </div>
          <button className="ops-btn ops-btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit}>
          <div className="ops-modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: "10px 14px", background: "var(--surface-sunk)", borderRadius: 10, fontSize: 13 }}>
              <div><b>Cargo:</b> {trip.cargoDescription}{trip.cargoWeight != null ? ` · ${trip.cargoWeight.toLocaleString()} kg` : ""}</div>
              <div style={{ color: "var(--trackify-text-secondary)", marginTop: 2 }}>
                {trip.driver || "No driver"}{trip.vehicle ? ` · ${trip.vehicle}` : ""}{trip.specialHandling ? ` · ${trip.specialHandling}` : ""}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><label style={labelStyle}>Quantity</label><input style={inputStyle} type="number" min="0" value={f.quantity} onChange={on("quantity")} placeholder={trip.cargoQuantity != null ? String(trip.cargoQuantity) : ""} /></div>
              <div><label style={labelStyle}>Condition</label>
                <select style={inputStyle} value={f.condition} onChange={on("condition")}>
                  <option value="good">Good</option>
                  <option value="partial">Partial</option>
                  <option value="damaged">Damaged</option>
                </select>
              </div>
            </div>
            <div><label style={labelStyle}>{mode === "release" ? "Released to" : "Returned by"}</label>
              <input style={inputStyle} value={f.counterparty} onChange={on("counterparty")} placeholder={mode === "release" ? "Driver / receiver name" : "Who brought it back"} />
            </div>
            {mode === "return" && (
              <div><label style={labelStyle}>Reason *</label>
                <input style={inputStyle} value={f.reason} onChange={on("reason")} required placeholder="e.g. Customer rejected delivery, address closed" />
              </div>
            )}
            <div><label style={labelStyle}>Notes</label><input style={inputStyle} value={f.notes} onChange={on("notes")} placeholder="Optional" /></div>
          </div>
          <div className="ops-modal-footer">
            <button type="button" className="ops-btn ops-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="ops-btn ops-btn-primary" disabled={saving}>
              {saving ? "Saving…" : mode === "release" ? "Confirm release" : "Log return"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CargoPage({ mode }) {
  const isRelease = mode === "release";
  const [queue, setQueue] = useState([]);
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState({ pendingRelease: 0, pendingReturn: 0, releasedToday: 0, totalReturned: 0 });
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("queue");
  const [acting, setActing] = useState(null);
  const [page, setPage] = useState(1);
  const perPage = 10;
  const { addToast } = useToast();

  const load = useCallback(async () => {
    try {
      const [q, e, s] = await Promise.all([getCargoQueue(mode), getCargoEvents(), getCargoStats()]);
      setQueue(q);
      setEvents(e.filter((x) => x.eventType === mode));
      setStats(s);
    } catch (err) { addToast(err.message || "Failed to load", "error"); }
  }, [mode, addToast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, tab]);

  const q = search.toLowerCase();
  const rows = (tab === "queue" ? queue : events).filter((r) =>
    !q ||
    (r.ticketNo || "").toLowerCase().includes(q) ||
    (r.route || "").toLowerCase().includes(q) ||
    (r.counterparty || "").toLowerCase().includes(q)
  );
  const total = rows.length;
  const totalPages = Math.ceil(total / perPage) || 1;
  const paged = rows.slice((page - 1) * perPage, page * perPage);

  return (
    <AppShell pageKey={`cargo-${mode}`}>
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left">
            <h1 className="ops-title">{isRelease ? "Cargo Release" : "Cargo Return"}</h1>
            <p className="ops-subtitle">
              {isRelease
                ? "Hand a dispatched trip's cargo over to the driver"
                : "Log cargo coming back from cancelled or undelivered trips"}
            </p>
          </div>
        </div>

        <div className="ops-stats-bar">
          {isRelease ? (
            <>
              <div className="ops-stat-pill"><span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: "#F59E0B" }} />Awaiting Release</span><span className="ops-stat-count">{stats.pendingRelease}</span></div>
              <div className="ops-stat-pill"><span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: "#22C55E" }} />Released Today</span><span className="ops-stat-count">{stats.releasedToday}</span></div>
            </>
          ) : (
            <>
              <div className="ops-stat-pill"><span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: "#F59E0B" }} />Awaiting Return</span><span className="ops-stat-count">{stats.pendingReturn}</span></div>
              <div className="ops-stat-pill"><span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: "#2455D6" }} />Total Returned</span><span className="ops-stat-count">{stats.totalReturned}</span></div>
            </>
          )}
        </div>

        <div className="ops-card">
          <div className="ops-card-header" style={{ justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 2 }}>
              <button className={`ops-filter-chip ${tab === "queue" ? "active" : ""}`} onClick={() => setTab("queue")}>Queue ({queue.length})</button>
              <button className={`ops-filter-chip ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}><History size={12} /> History ({events.length})</button>
            </div>
            <div className="ops-search" style={{ maxWidth: 260 }}>
              <Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} />
              <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          <div className="ops-table-wrapper">
            {tab === "queue" ? (
              <table className="ops-table">
                <thead><tr><th>Trip</th><th>Route</th><th>Cargo</th><th>Driver / Vehicle</th><th>Status</th><th style={{ width: 120 }}>Action</th></tr></thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr><td colSpan={6}><div className="ops-empty">{isRelease ? <PackageCheck size={32} style={{ opacity: 0.3 }} /> : <PackageX size={32} style={{ opacity: 0.3 }} />}<div className="ops-empty-title">Nothing in the queue</div><div className="ops-empty-desc">{isRelease ? "No dispatched trips waiting for cargo release" : "No trips with cargo to return"}</div></div></td></tr>
                  ) : paged.map((t) => (
                    <tr key={t.tripTicketId}>
                      <td style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-blue)" }}>{t.ticketNo}</td>
                      <td style={{ fontSize: 13 }}>{t.route}</td>
                      <td style={{ fontSize: 13 }}>{t.cargoDescription}{t.cargoWeight != null ? ` · ${t.cargoWeight.toLocaleString()} kg` : ""}</td>
                      <td style={{ fontSize: 13 }}>{[t.driver, t.vehicle].filter(Boolean).join(" · ") || "—"}</td>
                      <td style={{ fontSize: 12, textTransform: "capitalize" }}>{t.status.replace(/_/g, " ")}</td>
                      <td>
                        <Can permission={isRelease ? "cargo.release" : "cargo.return"} fallback={<span style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>—</span>}>
                          <button className="ops-btn ops-btn-primary" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => setActing(t)}>
                            {isRelease ? "Release" : "Log return"}
                          </button>
                        </Can>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="ops-table">
                <thead><tr><th>Trip</th><th>Route</th><th>Qty</th><th>Condition</th><th>{isRelease ? "Released to" : "Returned by"}</th>{!isRelease && <th>Reason</th>}<th>By</th><th>When</th></tr></thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr><td colSpan={isRelease ? 7 : 8}><div className="ops-empty"><History size={30} style={{ opacity: 0.3 }} /><div className="ops-empty-desc">No {mode} history yet</div></div></td></tr>
                  ) : paged.map((e) => {
                    const c = COND_COLORS[e.condition] || COND_COLORS.good;
                    return (
                      <tr key={e.id}>
                        <td style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-blue)" }}>{e.ticketNo}</td>
                        <td style={{ fontSize: 13 }}>{e.route}</td>
                        <td style={{ fontSize: 13 }}>{e.quantity ?? "—"}</td>
                        <td><span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text, textTransform: "capitalize" }}>{e.condition}</span></td>
                        <td style={{ fontSize: 13 }}>{e.counterparty || "—"}</td>
                        {!isRelease && <td style={{ fontSize: 12 }}>{e.reason || "—"}</td>}
                        <td style={{ fontSize: 12 }}>{e.handledBy}</td>
                        <td style={{ fontSize: 12 }}>{fmt(e.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} perPage={perPage} onPageChange={setPage} />
        </div>

        {acting && <CargoForm mode={mode} trip={acting} onClose={() => setActing(null)} onSaved={load} />}
      </div>
    </AppShell>
  );
}
