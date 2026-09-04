import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Landmark, Edit3, Trash2 } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import { PageShell, StatusPill, Modal, Field, TableCard } from "../../components/shared/crud";
import { Can } from "../../auth/permissions";
import ConfirmDialog from "../../components/shared/ConfirmDialog";
import { MiniStat, statGrid, fmtDate, Pager } from "./_bits";
import { dateInputValue, todayInput } from "../../utils/date";
import { birApi, peso } from "../../services/finance/financeService";

const DOC_TYPES = [
  { value: "official_receipt", label: "Official Receipt" },
  { value: "sales_invoice", label: "Sales Invoice" },
  { value: "form_2307", label: "Form 2307 (CWT)" },
  { value: "form_2306", label: "Form 2306 (Final WT)" },
  { value: "sales_book", label: "Sales Book" },
  { value: "purchase_book", label: "Purchase Book" },
];
const typeLabel = (v) => DOC_TYPES.find((d) => d.value === v)?.label || v;

export default function BirEisPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [docType, setDocType] = useState("");
  const [status, setStatus] = useState("");
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [page, setPage] = useState(1);
  const [pg, setPg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, st] = await Promise.all([birApi.listPage({ search, docType, status, page, limit: 25 }), birApi.stats()]);
      setRows(res.data); setPg(res.pagination); setStats(st);
    } catch (e) { addToast(e.message || "Failed to load records", "error"); }
    finally { setLoading(false); }
  }, [search, docType, status, page, addToast]);

  useEffect(() => { setPage(1); }, [search, docType, status]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function handleSave(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const payload = {
      docType: f.get("docType"), docNo: f.get("docNo"), docDate: f.get("docDate"),
      partyName: f.get("partyName"), tin: f.get("tin"),
      grossAmount: f.get("grossAmount"), taxAmount: f.get("taxAmount"), description: f.get("description"),
    };
    setSaving(true);
    try {
      if (modal.mode === "create") { await birApi.create(payload); addToast("Record added", "success"); }
      else { await birApi.update(modal.row.id, payload); addToast("Record updated", "success"); }
      setModal(null); load();
    } catch (err) { addToast(err.message || "Save failed", "error"); }
    finally { setSaving(false); }
  }

  async function setStatusOf(row, s) {
    try { await birApi.update(row.id, { status: s }); addToast("Updated", "success"); load(); }
    catch (e) { addToast(e.message || "Update failed", "error"); }
  }

  async function doDelete() {
    try { await birApi.remove(confirm.id); addToast("Record deleted", "success"); setConfirm(null); load(); }
    catch (e) { addToast(e.message || "Delete failed", "error"); }
  }

  return (
    <PageShell
      title="BIR / EIS Register"
      subtitle="Official receipts, withholding certificates and tax books"
      actions={
        <Can permission="bir.manage">
          <button className="ops-btn ops-btn-primary" onClick={() => setModal({ mode: "create" })}><Plus size={15} /> Add Record</button>
        </Can>
      }
    >
      <div style={statGrid}>
        <MiniStat label="Active" value={stats.active ?? 0} />
        <MiniStat label="Filed" value={stats.filed ?? 0} tone="ok" />
        <MiniStat label="Tax total" value={peso(stats.taxTotal)} />
        <MiniStat label="Records" value={stats.total ?? 0} />
      </div>

      <div className="ops-card" style={{ marginBottom: 14 }}>
        <div className="ops-filters" style={{ gap: 10, flexWrap: "wrap" }}>
          <div className="ops-search">
            <Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} />
            <input type="text" placeholder="Search doc no, party, TIN…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="ops-form-input" style={{ maxWidth: 190 }} value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="">All document types</option>
            {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <select className="ops-form-input" style={{ maxWidth: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {["active", "filed", "cancelled"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>

      <TableCard>
        <table className="ops-table">
          <thead>
            <tr><th>Date</th><th>Type</th><th>Doc No</th><th>Party</th><th>TIN</th><th style={{ textAlign: "right" }}>Gross</th><th style={{ textAlign: "right" }}>Tax</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9}><div className="ops-empty"><div className="ops-empty-desc">Loading…</div></div></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9}><div className="ops-empty"><div className="ops-empty-icon"><Landmark size={32} /></div><div className="ops-empty-title">No records found</div></div></td></tr>
            ) : rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.docDate)}</td>
                <td>{typeLabel(r.docType)}</td>
                <td style={{ fontWeight: 600, color: "var(--trackify-text)" }}>{r.docNo}</td>
                <td>{r.partyName || "—"}</td>
                <td>{r.tin || "—"}</td>
                <td className="tk-mono" style={{ textAlign: "right" }}>{peso(r.grossAmount)}</td>
                <td className="tk-mono" style={{ textAlign: "right" }}>{peso(r.taxAmount)}</td>
                <td><StatusPill status={r.status} /></td>
                <td>
                  <Can permission="bir.manage" fallback={<span style={{ color: "var(--trackify-text-muted)", fontSize: 12 }}>—</span>}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} title="Edit" onClick={() => setModal({ mode: "edit", row: r })}><Edit3 size={13} /></button>
                      {r.status === "active" && <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => setStatusOf(r, "filed")}>Mark filed</button>}
                      <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} title="Delete" onClick={() => setConfirm(r)}><Trash2 size={13} /></button>
                    </div>
                  </Can>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      <Pager pg={pg} onPage={setPage} />

      {modal && (
        <Modal title={modal.mode === "create" ? "Add BIR / EIS Record" : "Edit Record"} onClose={() => setModal(null)} width={560}>
          <form onSubmit={handleSave}>
            <div className="ops-form-row">
              <Field label="Document type *">
                <select className="ops-form-input" name="docType" defaultValue={modal.row?.docType || "official_receipt"} required>
                  {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </Field>
              <Field label="Document no. *"><input className="ops-form-input" name="docNo" required defaultValue={modal.row?.docNo || ""} /></Field>
            </div>
            <div className="ops-form-row">
              <Field label="Document date *"><input className="ops-form-input" type="date" name="docDate" required defaultValue={modal.row?.docDate ? dateInputValue(modal.row.docDate) : todayInput()} /></Field>
              <Field label="TIN"><input className="ops-form-input" name="tin" defaultValue={modal.row?.tin || ""} /></Field>
            </div>
            <Field label="Party name"><input className="ops-form-input" name="partyName" defaultValue={modal.row?.partyName || ""} /></Field>
            <div className="ops-form-row">
              <Field label="Gross amount (₱)"><input className="ops-form-input" type="number" step="any" name="grossAmount" defaultValue={modal.row?.grossAmount ?? ""} /></Field>
              <Field label="Tax amount (₱)"><input className="ops-form-input" type="number" step="any" name="taxAmount" defaultValue={modal.row?.taxAmount ?? ""} /></Field>
            </div>
            <Field label="Description"><input className="ops-form-input" name="description" defaultValue={modal.row?.description || ""} /></Field>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button type="button" className="ops-back-btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="ops-btn ops-btn-primary" disabled={saving} style={{ borderRadius: 10 }}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirm}
        title="Delete record"
        message={confirm ? `Delete ${typeLabel(confirm.docType)} ${confirm.docNo}?` : ""}
        confirmLabel="Delete"
        danger
        onConfirm={doDelete}
        onCancel={() => setConfirm(null)}
      />
    </PageShell>
  );
}
