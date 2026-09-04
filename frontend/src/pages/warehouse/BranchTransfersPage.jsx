import { useState, useEffect, useCallback } from "react";
import AppShell from "../../components/layout/AppShell";
import { Search, ArrowRightLeft, Eye, X, Plus, Trash2 } from "lucide-react";
import Pagination from "../../components/shared/Pagination";
import { useToast } from "../../components/shared/Toast";
import { Can } from "../../auth/permissions";
import {
  getAllTransfers, getTransferById, getTransferStats,
  createTransfer, approveTransfer, dispatchTransfer, receiveTransfer, cancelTransfer,
} from "../../services/warehouse/branchTransferService";
import { getAllLocations, getItems } from "../../services/warehouse/inventoryService";
import "../../styles/operations.css";

const STATUS_COLORS = {
  Draft: { bg: "#F1F5F9", text: "#64748B" }, Approved: { bg: "#EEF4FF", text: "#2455D6" },
  "In Transit": { bg: "#FEF3C7", text: "#92400E" }, Completed: { bg: "#DCFCE7", text: "#15803D" },
  Cancelled: { bg: "#F1F5F9", text: "#94A3BD" },
};
const ITEM_COLORS = { Confirmed: { bg: "#DCFCE7", text: "#15803D" }, Discrepancy: { bg: "#FEF2F2", text: "#B91C1C" }, Pending: { bg: "#F1F5F9", text: "#94A3BD" } };
const inputStyle = { padding: "8px 12px", border: "1px solid var(--trackify-border)", borderRadius: 8, fontSize: 13, width: "100%", background: "#F8FAFD" };
const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 4, display: "block" };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");

/* ---------------- create ---------------- */
function CreateTransfer({ branches, items, onClose, onSaved }) {
  const { addToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ sourceBranchId: "", destBranchId: "", notes: "" });
  const [lines, setLines] = useState([{ itemId: "", expectedQty: 1 }]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const addLine = () => setLines((l) => [...l, { itemId: "", expectedQty: 1 }]);
  const setLine = (i, k, v) => setLines((l) => l.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));
  const rmLine = (i) => setLines((l) => l.filter((_, idx) => idx !== i));

  async function submit(e) {
    e.preventDefault();
    const clean = lines.filter((r) => r.itemId && Number(r.expectedQty) > 0);
    if (!form.sourceBranchId || !form.destBranchId || form.sourceBranchId === form.destBranchId) {
      return addToast("Pick a different source and destination branch.", "error");
    }
    if (!clean.length) return addToast("Add at least one item.", "error");
    setSaving(true);
    try {
      const res = await createTransfer({
        sourceBranchId: Number(form.sourceBranchId),
        destBranchId: Number(form.destBranchId),
        notes: form.notes || undefined,
        items: clean.map((r) => ({ itemId: r.itemId, expectedQty: Number(r.expectedQty) })),
      });
      addToast(`Transfer ${res?.data?.transferNo || "created"}`, "success");
      onSaved();
      onClose();
    } catch (err) {
      addToast(err.message || "Failed to create transfer", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ops-modal-overlay" onClick={onClose}>
      <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="ops-modal-header"><h3 className="ops-modal-title">New Branch Transfer</h3><button className="ops-btn ops-btn-ghost" onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={submit}>
          <div className="ops-modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><label style={labelStyle}>Source Branch *</label>
                <select style={inputStyle} value={form.sourceBranchId} onChange={set("sourceBranchId")} required>
                  <option value="">Select branch</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div><label style={labelStyle}>Destination Branch *</label>
                <select style={inputStyle} value={form.destBranchId} onChange={set("destBranchId")} required>
                  <option value="">Select branch</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Items *</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {lines.map((row, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 32px", gap: 8, alignItems: "center" }}>
                    <select style={inputStyle} value={row.itemId} onChange={(e) => setLine(i, "itemId", e.target.value)}>
                      <option value="">Select item</option>
                      {items.map((it) => <option key={it.id} value={it.itemId}>{it.itemId} — {it.name}</option>)}
                    </select>
                    <input style={inputStyle} type="number" min="1" value={row.expectedQty} onChange={(e) => setLine(i, "expectedQty", e.target.value)} />
                    <button type="button" onClick={() => rmLine(i)} disabled={lines.length === 1} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#EF4444", opacity: lines.length === 1 ? 0.3 : 1 }}><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addLine} className="ops-btn ops-btn-ghost" style={{ marginTop: 8, fontSize: 12 }}><Plus size={13} /> Add item</button>
            </div>
            <div><label style={labelStyle}>Notes</label><input style={inputStyle} value={form.notes} onChange={set("notes")} placeholder="Optional" /></div>
          </div>
          <div className="ops-modal-footer">
            <button type="button" className="ops-btn ops-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="ops-btn ops-btn-primary" disabled={saving}>{saving ? "Creating…" : "Create Transfer"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- detail ---------------- */
function TransferDetail({ transfer, onClose, onAction }) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [recv, setRecv] = useState({});
  const raw = transfer.rawStatus;

  useEffect(() => {
    const init = {};
    transfer.items.forEach((it) => { init[it.id] = it.receivedQty ?? it.expectedQty; });
    setRecv(init);
  }, [transfer]);

  async function run(fn, ok) {
    setBusy(true);
    try { const r = await fn(); addToast(r?.message || ok, "success"); onAction(); }
    catch (e) { addToast(e.message || "Action failed", "error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="ops-modal-overlay" onClick={onClose}>
      <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="ops-modal-header">
          <div><h3 className="ops-modal-title">{transfer.transferNo}</h3><span style={{ fontSize: 13, color: "var(--trackify-text-secondary)" }}>{transfer.sourceBranchName} → {transfer.destBranchName}</span></div>
          <button className="ops-btn ops-btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ops-modal-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div style={{ padding: "10px 14px", background: "#F8FAFD", borderRadius: 10 }}><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Status</div><div style={{ fontWeight: 600, fontSize: 14 }}>{transfer.status}</div></div>
            <div style={{ padding: "10px 14px", background: "#F8FAFD", borderRadius: 10 }}><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Requested by</div><div style={{ fontWeight: 600, fontSize: 14 }}>{transfer.requestedBy}</div></div>
            <div style={{ padding: "10px 14px", background: "#F8FAFD", borderRadius: 10 }}><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Dispatched / Received</div><div style={{ fontWeight: 600, fontSize: 13 }}>{fmtDate(transfer.dispatchedAt)} · {fmtDate(transfer.receivedAt)}</div></div>
          </div>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 10, textTransform: "uppercase" }}>Items</h4>
          <table className="ops-table" style={{ margin: 0 }}>
            <thead><tr><th>Item</th><th>Expected</th><th>Received</th><th>Status</th></tr></thead>
            <tbody>
              {transfer.items.map((it) => {
                const c = ITEM_COLORS[it.status] || ITEM_COLORS.Pending;
                return (
                  <tr key={it.id}>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{it.name}<div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>{it.itemId}</div></td>
                    <td style={{ fontSize: 13 }}>{it.expectedQty}</td>
                    <td style={{ fontSize: 13 }}>
                      {raw === "in_transit" ? (
                        <input type="number" min="0" value={recv[it.id] ?? ""} onChange={(e) => setRecv((p) => ({ ...p, [it.id]: e.target.value }))} style={{ width: 70, padding: "4px 8px", border: "1px solid var(--trackify-border)", borderRadius: 6, fontSize: 12 }} />
                      ) : (it.receivedQty ?? "—")}
                    </td>
                    <td><span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text }}>{it.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {transfer.notes && <div style={{ marginTop: 12, padding: "8px 12px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, fontSize: 12, color: "#92400E" }}>Note: {transfer.notes}</div>}
        </div>
        <div className="ops-modal-footer">
          <button className="ops-btn ops-btn-secondary" onClick={onClose}>Close</button>
          <Can permission="transfer.manage">
            {raw === "draft" && <button className="ops-btn ops-btn-primary" disabled={busy} onClick={() => run(() => approveTransfer(transfer.id), "Approved")}>Approve</button>}
            {raw === "approved" && <button className="ops-btn ops-btn-primary" disabled={busy} onClick={() => run(() => dispatchTransfer(transfer.id), "Dispatched")}>Dispatch (deduct source)</button>}
            {raw === "in_transit" && <button className="ops-btn ops-btn-primary" disabled={busy} onClick={() => run(() => receiveTransfer(transfer.id, Object.fromEntries(Object.entries(recv).map(([k, v]) => [k, Number(v) || 0]))), "Received")}>Confirm receipt</button>}
            {["draft", "approved"].includes(raw) && <button className="ops-btn ops-btn-secondary" style={{ color: "#EF4444" }} disabled={busy} onClick={() => run(() => cancelTransfer(transfer.id), "Cancelled")}>Cancel transfer</button>}
          </Can>
        </div>
      </div>
    </div>
  );
}

/* ---------------- page ---------------- */
export default function BranchTransfersPage() {
  const [all, setAll] = useState([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, inTransit: 0, completed: 0, discrepancies: 0 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [branches, setBranches] = useState([]);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const perPage = 10;
  const { addToast } = useToast();

  useEffect(() => {
    getAllLocations().then((l) => setBranches(l.filter((x) => x.locationType === "branch"))).catch(() => {});
    getItems().then(setItems).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([
        getAllTransfers({ search, status: statusFilter }),
        getTransferStats(),
      ]);
      setAll(t);
      setStats(s);
    } catch (e) { addToast(e.message || "Failed to load transfers", "error"); }
  }, [search, statusFilter, addToast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const refreshDetail = async () => {
    if (selected) {
      try { setSelected(await getTransferById(selected.id)); } catch { /* keep */ }
    }
    load();
  };

  const total = all.length;
  const totalPages = Math.ceil(total / perPage) || 1;
  const rows = all.slice((page - 1) * perPage, page * perPage);

  return (
    <AppShell>
      <div className="ops-container">
        <div className="ops-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div className="ops-header-left"><h1 className="ops-title">Branch Transfers</h1><p className="ops-subtitle">Move stock between branches — dispatch deducts the source, receipt adds to the destination</p></div>
          <Can permission="transfer.manage">
            <button className="ops-btn ops-btn-primary" onClick={() => setCreating(true)}><Plus size={15} /> New Transfer</button>
          </Can>
        </div>
        <div className="ops-stats-bar">
          {[
            { label: "Total", count: stats.total, color: "#071A4A" }, { label: "Pending", count: stats.pending, color: "#64748B" },
            { label: "In Transit", count: stats.inTransit, color: "#F59E0B" }, { label: "Completed", count: stats.completed, color: "#22C55E" },
            { label: "Discrepancies", count: stats.discrepancies, color: "#EF4444" },
          ].map((s) => (
            <div key={s.label} className="ops-stat-pill">
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: s.color }} />{s.label}</span>
              <span className="ops-stat-count">{s.count}</span>
            </div>
          ))}
        </div>
        <div className="ops-card">
          <div className="ops-card-header" style={{ justifyContent: "space-between" }}>
            <div className="ops-search"><Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} /><input type="text" placeholder="Search transfers..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 130 }}>
              <option value="">All Statuses</option>
              {["Draft", "Approved", "In Transit", "Completed", "Cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="ops-table-wrapper">
            <table className="ops-table">
              <thead><tr><th>Transfer No</th><th>From</th><th>To</th><th>Items</th><th>Status</th><th>Created</th><th style={{ width: 60 }}>View</th></tr></thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7}><div className="ops-empty"><ArrowRightLeft size={32} style={{ opacity: 0.3 }} /><div className="ops-empty-title">No transfers found</div><div className="ops-empty-desc">{search || statusFilter ? "Try adjusting your filters" : "Create your first branch transfer"}</div></div></td></tr>
                ) : rows.map((t) => {
                  const c = STATUS_COLORS[t.status] || STATUS_COLORS.Draft;
                  return (
                    <tr key={t.id}>
                      <td style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-blue)" }}>{t.transferNo}</td>
                      <td style={{ fontSize: 13 }}>{t.sourceBranchName}</td>
                      <td style={{ fontSize: 13 }}>{t.destBranchName}</td>
                      <td style={{ fontSize: 13 }}>{t.items.length} item{t.items.length === 1 ? "" : "s"}</td>
                      <td><span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text }}>{t.status}</span></td>
                      <td style={{ fontSize: 13 }}>{fmtDate(t.createdAt)}</td>
                      <td><button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setSelected(t)}><Eye size={13} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} perPage={perPage} onPageChange={setPage} />
        </div>

        {selected && <TransferDetail transfer={selected} onClose={() => setSelected(null)} onAction={refreshDetail} />}
        {creating && <CreateTransfer branches={branches} items={items} onClose={() => setCreating(false)} onSaved={load} />}
      </div>
    </AppShell>
  );
}
