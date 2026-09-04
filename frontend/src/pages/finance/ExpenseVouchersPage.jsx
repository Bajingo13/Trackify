import { useState, useEffect, useCallback } from "react";
import { Plus, Search, FileText } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import { PageShell, StatusPill, Modal, Field, TableCard } from "../../components/shared/crud";
import { Can } from "../../auth/permissions";
import LineItems from "./_LineItems";
import { Pager } from "./_bits";
import { voucherApi, expenseApi, peso } from "../../services/finance/financeService";
import { formatDate as fmtDate } from "../../utils/date";

export default function ExpenseVouchersPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState(null); // {mode:'create'} | {mode:'edit', data}
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pg, setPg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, st] = await Promise.all([voucherApi.listPage({ search, status, page, limit: 25 }), voucherApi.stats()]);
      setRows(res.data); setPg(res.pagination); setStats(st);
    } catch (e) {
      addToast(e.message || "Failed to load vouchers", "error");
    } finally { setLoading(false); }
  }, [search, status, page, addToast]);

  useEffect(() => { setPage(1); }, [search, status]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function openDetail(id) {
    try { setDetail(await voucherApi.get(id)); }
    catch (e) { addToast(e.message || "Failed to load voucher", "error"); }
  }

  async function act(fn, okMsg) {
    setBusy(true);
    try {
      const res = await fn();
      addToast(okMsg, "success");
      // workflow actions return the refreshed voucher (has .lines); delete
      // returns just { id } — in that case close the modal.
      if (res?.data?.lines) setDetail(res.data);
      else setDetail(null);
      load();
    } catch (e) {
      addToast(e.message || "Action failed", "error");
    } finally { setBusy(false); }
  }

  return (
    <PageShell
      title="Expense Vouchers"
      subtitle="Cash-out documents for driver reimbursements and other payables"
      actions={
        <Can permission="voucher.manage">
          <button className="ops-btn ops-btn-primary" onClick={() => setForm({ mode: "create" })}><Plus size={15} /> New Voucher</button>
        </Can>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 14 }}>
        <MiniStat label="Awaiting approval" value={stats.awaitingApproval ?? 0} tone="warn" />
        <MiniStat label="Approved, unpaid" value={peso(stats.approvedUnpaid)} />
        <MiniStat label="Paid" value={peso(stats.paid)} tone="ok" />
        <MiniStat label="Total" value={stats.total ?? 0} />
      </div>

      <div className="ops-card" style={{ marginBottom: 14 }}>
        <div className="ops-filters" style={{ gap: 10, flexWrap: "wrap" }}>
          <div className="ops-search">
            <Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} />
            <input type="text" placeholder="Search voucher no, payee…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="ops-form-input" style={{ maxWidth: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {["draft", "submitted", "approved", "rejected", "paid"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>

      <TableCard>
        <table className="ops-table">
          <thead>
            <tr><th>Voucher No</th><th>Payee</th><th>Purpose</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th><th>Created</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6}><div className="ops-empty"><div className="ops-empty-desc">Loading…</div></div></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6}><div className="ops-empty"><div className="ops-empty-icon"><FileText size={32} /></div><div className="ops-empty-title">No vouchers found</div></div></td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => openDetail(r.id)}>
                <td style={{ fontWeight: 600, color: "var(--trackify-text)" }}>{r.voucherNo}</td>
                <td>{r.payee}</td>
                <td>{r.purpose || "—"}</td>
                <td className="tk-mono" style={{ textAlign: "right" }}>{peso(r.totalAmount)}</td>
                <td><StatusPill status={r.status} /></td>
                <td>{fmtDate(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      <Pager pg={pg} onPage={setPage} />

      {form && (
        <VoucherForm
          mode={form.mode}
          data={form.data}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); load(); }}
          addToast={addToast}
        />
      )}

      {detail && (
        <Modal title={detail.voucherNo} onClose={() => setDetail(null)} width={560}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{detail.payee}</div>
              <div style={{ fontSize: 12, color: "var(--text-2)" }}>{detail.purpose || "—"}</div>
            </div>
            <StatusPill status={detail.status} />
          </div>
          <table className="ops-table" style={{ marginBottom: 10 }}>
            <thead><tr><th>Description</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.id}><td>{l.description}</td><td className="tk-mono" style={{ textAlign: "right" }}>{peso(l.amount)}</td></tr>
              ))}
              <tr><td style={{ fontWeight: 700 }}>Total</td><td className="tk-mono" style={{ textAlign: "right", fontWeight: 700 }}>{peso(detail.totalAmount)}</td></tr>
            </tbody>
          </table>
          {(detail.submittedBy || detail.approvedBy) && (
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 10 }}>
              {detail.submittedBy && <>Submitted by {detail.submittedBy} · {fmtDate(detail.submittedAt)}<br /></>}
              {detail.approvedBy && <>Approved by {detail.approvedBy} · {fmtDate(detail.approvedAt)}<br /></>}
              {detail.paidAt && <>Paid {fmtDate(detail.paidAt)}</>}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            {detail.status === "draft" && (
              <Can permission="voucher.manage">
                <button className="ops-btn ops-btn-secondary" disabled={busy} onClick={() => { setForm({ mode: "edit", data: detail }); setDetail(null); }}>Edit</button>
                <button className="ops-btn ops-btn-primary" disabled={busy} onClick={() => act(() => voucherApi.submit(detail.id), "Voucher submitted")}>Submit for approval</button>
              </Can>
            )}
            {detail.status === "submitted" && (
              <Can permission="voucher.approve">
                <button className="ops-btn ops-btn-secondary" disabled={busy} onClick={() => act(() => voucherApi.reject(detail.id), "Voucher rejected")}>Reject</button>
                <button className="ops-btn ops-btn-primary" disabled={busy} onClick={() => act(() => voucherApi.approve(detail.id), "Voucher approved")}>Approve</button>
              </Can>
            )}
            {detail.status === "approved" && (
              <Can permission="voucher.approve">
                <button className="ops-btn ops-btn-primary" disabled={busy} onClick={() => act(() => voucherApi.pay(detail.id), "Marked as paid")}>Mark as paid</button>
              </Can>
            )}
            {["draft", "rejected"].includes(detail.status) && (
              <Can permission="voucher.manage">
                <button className="ops-btn ops-btn-ghost" disabled={busy} onClick={() => act(() => voucherApi.remove(detail.id), "Voucher deleted")}>Delete</button>
              </Can>
            )}
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

function VoucherForm({ mode, data, onClose, onSaved, addToast }) {
  const editing = mode === "edit";
  const [lines, setLines] = useState(
    editing && data?.lines?.length
      ? data.lines.map((l) => ({ description: l.description, amount: String(l.amount), tripExpenseId: l.tripExpenseId || null }))
      : [{ description: "", amount: "" }]
  );
  const [saving, setSaving] = useState(false);
  const [recorded, setRecorded] = useState([]);

  useEffect(() => {
    expenseApi.list({ status: "recorded" }).then(setRecorded).catch(() => {});
  }, []);

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const payload = {
      payee: f.get("payee"),
      purpose: f.get("purpose"),
      notes: f.get("notes"),
      lines: lines.filter((l) => l.description && Number(l.amount) > 0)
        .map((l) => ({ description: l.description, amount: Number(l.amount), tripExpenseId: l.tripExpenseId || null })),
    };
    if (!payload.lines.length) { addToast("Add at least one line", "error"); return; }
    setSaving(true);
    try {
      if (editing) {
        await voucherApi.update(data.id, payload);
        addToast("Voucher updated", "success");
      } else {
        await voucherApi.create(payload);
        addToast("Voucher created", "success");
      }
      onSaved();
    } catch (err) {
      addToast(err.message || "Save failed", "error");
    } finally { setSaving(false); }
  }

  return (
    <Modal title={editing ? `Edit ${data.voucherNo}` : "New Expense Voucher"} onClose={onClose} width={620}>
      <form onSubmit={submit}>
        <div className="ops-form-row">
          <Field label="Payee *"><input className="ops-form-input" name="payee" required defaultValue={data?.payee || ""} /></Field>
          <Field label="Purpose"><input className="ops-form-input" name="purpose" defaultValue={data?.purpose || ""} /></Field>
        </div>
        {recorded.length > 0 && (
          <Field label="Pull from unvouchered expenses">
            <select
              className="ops-form-input"
              onChange={(e) => {
                const ex = recorded.find((x) => String(x.id) === e.target.value);
                if (ex) setLines((prev) => [...prev.filter((l) => l.description || l.amount), { description: `${ex.category} — ${ex.description || ex.receiptNo || "expense"}`, amount: String(ex.amount), tripExpenseId: ex.id }]);
                e.target.value = "";
              }}
            >
              <option value="">— add an expense line —</option>
              {recorded.map((x) => <option key={x.id} value={x.id}>{x.category} · {peso(x.amount)} · {x.description || x.receiptNo || fmtDate(x.expenseDate)}</option>)}
            </select>
          </Field>
        )}
        <Field label="Line items *">
          <LineItems
            cols={[{ key: "description", label: "Description" }, { key: "amount", label: "Amount", type: "number", width: 140 }]}
            value={lines}
            onChange={setLines}
          />
        </Field>
        <div style={{ textAlign: "right", fontWeight: 700, margin: "6px 2px" }}>Total: <span className="tk-mono">{peso(total)}</span></div>
        <Field label="Notes"><input className="ops-form-input" name="notes" defaultValue={data?.notes || ""} /></Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <button type="button" className="ops-back-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="ops-btn ops-btn-primary" disabled={saving} style={{ borderRadius: 10 }}>{saving ? "Saving…" : editing ? "Save changes" : "Create voucher"}</button>
        </div>
      </form>
    </Modal>
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
