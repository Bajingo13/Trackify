import { useState, useEffect } from "react";
import { Search, ArrowRightLeft, Eye, X } from "lucide-react";
import TopNav from "../../components/dashboard/TopNav";
import Pagination from "../../components/shared/Pagination";
import { useToast } from "../../components/shared/Toast";
import { getAllTransfers, getTransferById, approveTransfer, confirmSource, scanItem, confirmDestination, getTransferStats } from "../../services/warehouse/branchTransferService";
import "../../styles/operations.css";

const STATUS_COLORS = { Pending: { bg: "#F1F5F9", text: "#94A3BD" }, Approved: { bg: "#EEF4FF", text: "#2455D6" }, "In Transit": { bg: "#FEF3C7", text: "#92400E" }, Completed: { bg: "#DCFCE7", text: "#15803D" } };
const ITEM_STATUS_COLORS = { Confirmed: { bg: "#DCFCE7", text: "#15803D" }, Discrepancy: { bg: "#FEF2F2", text: "#B91C1C" }, Pending: { bg: "#F1F5F9", text: "#94A3BD" }, Over: { bg: "#FEF3C7", text: "#92400E" } };

function TransferDetail({ transfer, onClose, onAction, toast }) {
  const [scanInputs, setScanInputs] = useState({});
  const handleScan = (itemId) => {
    const qty = Number(scanInputs[itemId]);
    if (isNaN(qty) || qty < 0) { toast("Please enter a valid quantity", "error"); return; }
    const result = scanItem(transfer.id, itemId, qty);
    if (result.success) { toast("Item scanned successfully"); onAction(); } else { toast(result.message, "error"); }
  };
  return (
    <div className="ops-modal-overlay" onClick={onClose}>
      <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 700 }}>
        <div className="ops-modal-header">
          <div><h3 className="ops-modal-title">{transfer.transferNo}</h3><span style={{ fontSize: 13, color: "var(--trackify-text-secondary)" }}>{transfer.sourceBranchName} → {transfer.destBranchName}</span></div>
          <button className="ops-btn ops-btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ops-modal-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div style={{ padding: "10px 14px", background: "#F8FAFD", borderRadius: 10 }}><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Status</div><div style={{ fontWeight: 600, fontSize: 14 }}>{transfer.status}</div></div>
            <div style={{ padding: "10px 14px", background: "#F8FAFD", borderRadius: 10 }}><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Requested By</div><div style={{ fontWeight: 600, fontSize: 14 }}>{transfer.requestedBy}</div></div>
            <div style={{ padding: "10px 14px", background: "#F8FAFD", borderRadius: 10 }}><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Source Confirmed</div><div style={{ fontWeight: 600, fontSize: 14, color: transfer.sourceConfirmed ? "#22C55E" : "#F59E0B" }}>{transfer.sourceConfirmed ? "Yes" : "No"}</div></div>
            <div style={{ padding: "10px 14px", background: "#F8FAFD", borderRadius: 10 }}><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Destination Confirmed</div><div style={{ fontWeight: 600, fontSize: 14, color: transfer.destConfirmed ? "#22C55E" : "#F59E0B" }}>{transfer.destConfirmed ? "Yes" : "No"}</div></div>
          </div>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 10, textTransform: "uppercase" }}>Transfer Items</h4>
          <table className="ops-table" style={{ margin: 0 }}>
            <thead><tr><th>Item</th><th>Expected</th><th>Scanned</th><th>Received</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {transfer.items.map((item, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</td>
                  <td style={{ fontSize: 13 }}>{item.expectedQty}</td>
                  <td style={{ fontSize: 13, fontWeight: 600 }}>{item.scannedQty ?? "—"}</td>
                  <td style={{ fontSize: 13 }}>{item.receivedQty ?? "—"}</td>
                  <td><span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: (ITEM_STATUS_COLORS[item.status] || ITEM_STATUS_COLORS.Pending).bg, color: (ITEM_STATUS_COLORS[item.status] || ITEM_STATUS_COLORS.Pending).text }}>{item.status}</span></td>
                  <td>
                    {!transfer.destConfirmed && transfer.status !== "Completed" && (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input type="number" value={scanInputs[item.itemId] || ""} onChange={(e) => setScanInputs((p) => ({ ...p, [item.itemId]: e.target.value }))} style={{ width: 60, padding: "4px 8px", border: "1px solid var(--trackify-border)", borderRadius: 6, fontSize: 12 }} min="0" placeholder="Qty" />
                        <button className="ops-btn ops-btn-primary" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => handleScan(item.itemId)}>Scan</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {transfer.notes && <div style={{ marginTop: 12, padding: "8px 12px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, fontSize: 12, color: "#92400E" }}>Note: {transfer.notes}</div>}
        </div>
        <div className="ops-modal-footer">
          <button className="ops-btn ops-btn-secondary" onClick={onClose}>Close</button>
          {transfer.status === "Pending" && <button className="ops-btn ops-btn-primary" onClick={() => { approveTransfer(transfer.id); toast("Transfer approved"); onAction(); onClose(); }}>Approve</button>}
          {transfer.status === "In Transit" && !transfer.sourceConfirmed && <button className="ops-btn ops-btn-primary" onClick={() => { confirmSource(transfer.id); toast("Source confirmed"); onAction(); onClose(); }}>Confirm Source</button>}
          {transfer.status === "In Transit" && transfer.sourceConfirmed && !transfer.destConfirmed && <button className="ops-btn ops-btn-primary" onClick={() => { const r = confirmDestination(transfer.id); if (r.success) { toast("Transfer completed"); onAction(); onClose(); } else { toast(r.message, "error"); } }}>Confirm Receipt</button>}
        </div>
      </div>
    </div>
  );
}

export default function BranchTransfersPage() {
  const [allTransfers, setAllTransfers] = useState([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, inTransit: 0, completed: 0, discrepancies: 0 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedTransfer, setSelectedTransfer] = useState(null);
  const [page, setPage] = useState(1);
  const perPage = 10;
  const { addToast } = useToast();

  const loadData = () => {
    setAllTransfers(getAllTransfers({ search, status: statusFilter }));
    setStats(getTransferStats());
  };
  useEffect(() => { loadData(); }, [search, statusFilter]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const refreshDetail = () => { if (selectedTransfer) { setSelectedTransfer(getTransferById(selectedTransfer.id)); loadData(); } };

  const total = allTransfers.length;
  const totalPages = Math.ceil(total / perPage);
  const transfers = allTransfers.slice((page - 1) * perPage, page * perPage);

  const inputStyle = { padding: "8px 12px", border: "1px solid var(--trackify-border)", borderRadius: 8, fontSize: 13, background: "#F8FAFD" };

  return (
    <div className="ops-page">
      <TopNav />
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left"><h1 className="ops-title">Branch Transfers</h1><p className="ops-subtitle">Manage inter-branch stock transfers</p></div>
        </div>
        <div className="ops-stats-bar">
          {[
            { label: "Total", count: stats.total, color: "#071A4A" }, { label: "Pending", count: stats.pending, color: "#94A3BD" },
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
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, minWidth: 130 }}>
              <option value="">All Statuses</option>
              {["Pending", "Approved", "In Transit", "Completed"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="ops-table-wrapper">
            <table className="ops-table">
              <thead><tr><th>Transfer No</th><th>From</th><th>To</th><th>Items</th><th>Status</th><th>Date</th><th style={{ width: 60 }}>Actions</th></tr></thead>
              <tbody>
                {transfers.length === 0 ? (
                  <tr><td colSpan={7}><div className="ops-empty"><ArrowRightLeft size={32} style={{ opacity: 0.3 }} /><div className="ops-empty-title">No transfers found</div><div className="ops-empty-desc">{search || statusFilter ? "Try adjusting your filters" : "No branch transfers recorded"}</div></div></td></tr>
                ) : transfers.map((t) => {
                  const sc = STATUS_COLORS[t.status] || STATUS_COLORS.Pending;
                  return (
                    <tr key={t.id}>
                      <td style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-blue)" }}>{t.transferNo}</td>
                      <td style={{ fontSize: 13 }}>{t.sourceBranchName}</td>
                      <td style={{ fontSize: 13 }}>{t.destBranchName}</td>
                      <td style={{ fontSize: 13 }}>{t.items.length} items</td>
                      <td><span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.text }}>{t.status}</span></td>
                      <td style={{ fontSize: 13 }}>{t.createdAt}</td>
                      <td><button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setSelectedTransfer(t)}><Eye size={13} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} perPage={perPage} onPageChange={setPage} />
        </div>
        {selectedTransfer && <TransferDetail transfer={selectedTransfer} onClose={() => setSelectedTransfer(null)} onAction={refreshDetail} toast={addToast} />}
      </div>
    </div>
  );
}
