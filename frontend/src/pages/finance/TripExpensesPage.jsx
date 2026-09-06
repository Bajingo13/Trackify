import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Receipt, Edit3, Trash2 } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import { PageShell, StatusPill, Modal, Field, TableCard } from "../../components/shared/crud";
import { Pager } from "./_bits";
import { Can } from "../../auth/permissions";
import DriverClaimReview from "./DriverClaimReview";
import ConfirmDialog from "../../components/shared/ConfirmDialog";
import { expenseApi, peso } from "../../services/finance/financeService";
import { getAllTrips } from "../../services/operations/tripService";
import { formatDate as fmtDate, dateInputValue, todayInput } from "../../utils/date";

const CATEGORIES = ["fuel", "toll", "parking", "meals", "lodging", "repair", "misc"];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export default function TripExpensesPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({});
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [modal, setModal] = useState(null); // {mode, row?}
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [page, setPage] = useState(1);
  const [pg, setPg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, st] = await Promise.all([
        expenseApi.listPage({ search, category, status, page, limit: 25 }),
        expenseApi.stats(),
      ]);
      setRows(res.data);
      setPg(res.pagination);
      setStats(st);
    } catch (e) {
      addToast(e.message || "Failed to load expenses", "error");
    } finally {
      setLoading(false);
    }
  }, [search, category, status, page, addToast]);

  useEffect(() => { setPage(1); }, [search, category, status]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    getAllTrips({ limit: 500 }).then(setTrips).catch(() => {});
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const payload = {
      category: f.get("category"),
      tripTicketId: f.get("tripTicketId") || null,
      description: f.get("description"),
      amount: f.get("amount"),
      expenseDate: f.get("expenseDate"),
      receiptNo: f.get("receiptNo"),
    };
    setSaving(true);
    try {
      if (modal.mode === "create") {
        await expenseApi.create(payload);
        addToast("Expense recorded", "success");
      } else {
        await expenseApi.update(modal.row.id, payload);
        addToast("Expense updated", "success");
      }
      setModal(null);
      load();
    } catch (err) {
      addToast(err.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    try {
      await expenseApi.remove(confirm.id);
      addToast("Expense deleted", "success");
      setConfirm(null);
      load();
    } catch (err) {
      addToast(err.message || "Delete failed", "error");
    }
  }

  return (
    <PageShell
      title="Trip Expenses"
      subtitle="Fuel, tolls and other costs incurred running trips"
      actions={
        <Can permission="expense.manage">
          <button className="ops-btn ops-btn-primary" onClick={() => setModal({ mode: "create" })}>
            <Plus size={15} /> Record Expense
          </button>
        </Can>
      }
    >
      <Can permission="expense.manage">
        <DriverClaimReview onReviewed={load} />
      </Can>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 14 }}>
        <MiniStat label="Total recorded" value={peso(stats.totalAmount)} />
        <MiniStat label="Not yet vouchered" value={peso(stats.unvouchered)} tone="warn" />
        <MiniStat label="Reimbursed" value={peso(stats.reimbursed)} tone="ok" />
        <MiniStat label="Entries" value={stats.total ?? 0} />
      </div>

      <div className="ops-card" style={{ marginBottom: 14 }}>
        <div className="ops-filters" style={{ gap: 10, flexWrap: "wrap" }}>
          <div className="ops-search">
            <Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} />
            <input type="text" placeholder="Search description, receipt, trip…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="ops-form-input" style={{ maxWidth: 170 }} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
          </select>
          <select className="ops-form-input" style={{ maxWidth: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            <option value="recorded">Recorded</option>
            <option value="on_voucher">On voucher</option>
            <option value="reimbursed">Reimbursed</option>
          </select>
        </div>
      </div>

      <TableCard>
        <table className="ops-table">
          <thead>
            <tr>
              <th>Date</th><th>Category</th><th>Description</th><th>Trip</th>
              <th>Receipt</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8}><div className="ops-empty"><div className="ops-empty-desc">Loading…</div></div></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8}><div className="ops-empty"><div className="ops-empty-icon"><Receipt size={32} /></div><div className="ops-empty-title">No expenses found</div></div></td></tr>
            ) : rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.expenseDate)}</td>
                <td>{cap(r.category)}</td>
                <td style={{ fontWeight: 600, color: "var(--trackify-text)" }}>{r.description || "—"}</td>
                <td>{r.tripNo || "—"}</td>
                <td>{r.receiptNo || "—"}</td>
                <td className="tk-mono" style={{ textAlign: "right" }}>{peso(r.amount)}</td>
                <td><StatusPill status={r.status} /></td>
                <td>
                  {r.status === "recorded" ? (
                    <Can permission="expense.manage" fallback={<span style={{ color: "var(--trackify-text-muted)", fontSize: 12 }}>—</span>}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} title="Edit" onClick={() => setModal({ mode: "edit", row: r })}><Edit3 size={13} /></button>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} title="Delete" onClick={() => setConfirm(r)}><Trash2 size={13} /></button>
                      </div>
                    </Can>
                  ) : (
                    <span style={{ color: "var(--trackify-text-muted)", fontSize: 12 }}>{r.voucherNo || "—"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      <Pager pg={pg} onPage={setPage} />

      {modal && (
        <Modal title={modal.mode === "create" ? "Record Expense" : "Edit Expense"} onClose={() => setModal(null)} width={520}>
          <form onSubmit={handleSave}>
            <div className="ops-form-row">
              <Field label="Category *">
                <select className="ops-form-input" name="category" defaultValue={modal.row?.category || "fuel"} required>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
                </select>
              </Field>
              <Field label="Amount (₱) *">
                <input className="ops-form-input" type="number" step="any" name="amount" required defaultValue={modal.row?.amount ?? ""} />
              </Field>
            </div>
            <div className="ops-form-row">
              <Field label="Expense date *">
                <input className="ops-form-input" type="date" name="expenseDate" required
                  defaultValue={modal.row?.expenseDate ? dateInputValue(modal.row.expenseDate) : todayInput()} />
              </Field>
              <Field label="Receipt no.">
                <input className="ops-form-input" name="receiptNo" defaultValue={modal.row?.receiptNo || ""} />
              </Field>
            </div>
            <Field label="Trip (optional)">
              <select className="ops-form-input" name="tripTicketId" defaultValue={modal.row?.tripTicketId || ""}>
                <option value="">— none —</option>
                {/* keep the existing link selectable even if that trip isn't in the recent list */}
                {modal.row?.tripTicketId && !trips.some((t) => String(t.id) === String(modal.row.tripTicketId)) && (
                  <option value={modal.row.tripTicketId}>{modal.row.tripNo || `Trip #${modal.row.tripTicketId}`}</option>
                )}
                {trips.map((t) => <option key={t.id} value={t.id}>{t.ticketNo || t.id} · {t.origin} → {t.destination}</option>)}
              </select>
            </Field>
            <Field label="Description">
              <input className="ops-form-input" name="description" defaultValue={modal.row?.description || ""} />
            </Field>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button type="button" className="ops-back-btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="ops-btn ops-btn-primary" disabled={saving} style={{ borderRadius: 10 }}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirm}
        title="Delete expense"
        message={confirm ? `Delete this ${confirm.category} expense of ${peso(confirm.amount)}?` : ""}
        confirmLabel="Delete"
        onConfirm={doDelete}
        onCancel={() => setConfirm(null)}
      />
    </PageShell>
  );
}

function MiniStat({ label, value, tone }) {
  const color = tone === "warn" ? "var(--warn)" : tone === "ok" ? "var(--ok)" : "var(--text)";
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "12px 14px" }}>
      <div style={{ fontSize: "var(--fs-11)", textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text-2)", fontWeight: 600 }}>{label}</div>
      <div className="tk-mono" style={{ fontSize: "var(--fs-18)", color, marginTop: 4 }}>{value}</div>
    </div>
  );
}
