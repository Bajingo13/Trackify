import { useState, useEffect, useCallback } from "react";
import { Plus, Search, ReceiptText } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import { PageShell, StatusPill, Modal, Field, TableCard } from "../../components/shared/crud";
import { Can } from "../../auth/permissions";
import LineItems from "./_LineItems";
import { MiniStat, statGrid, fmtDate, Pager } from "./_bits";
import { dateInputValue, todayInput } from "../../utils/date";
import { invoiceApi, peso } from "../../services/finance/financeService";
import { listCustomers } from "../../services/master-data/customerService";

export default function InvoicesPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({});
  const [customers, setCustomers] = useState([]);
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
      const [res, st] = await Promise.all([invoiceApi.listPage({ search, status, page, limit: 25 }), invoiceApi.stats()]);
      setRows(res.data); setPg(res.pagination); setStats(st);
    } catch (e) { addToast(e.message || "Failed to load invoices", "error"); }
    finally { setLoading(false); }
  }, [search, status, page, addToast]);

  useEffect(() => { setPage(1); }, [search, status]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { listCustomers({ limit: 500 }).then((r) => setCustomers(r.data || [])).catch(() => {}); }, []);

  async function openDetail(id) {
    try { setDetail(await invoiceApi.get(id)); }
    catch (e) { addToast(e.message || "Failed to load invoice", "error"); }
  }

  async function act(fn, okMsg) {
    setBusy(true);
    try {
      const res = await fn();
      addToast(okMsg, "success");
      if (res?.data?.lines) setDetail(res.data);
      else setDetail(null);
      load();
    } catch (e) { addToast(e.message || "Action failed", "error"); }
    finally { setBusy(false); }
  }

  const [payFor, setPayFor] = useState(null); // invoice detail currently being paid

  return (
    <PageShell
      title="Invoices"
      subtitle="Freight billing to customers and collections"
      actions={
        <Can permission="invoice.manage">
          <button className="ops-btn ops-btn-primary" onClick={() => setForm({ mode: "create" })}><Plus size={15} /> New Invoice</button>
        </Can>
      }
    >
      <div style={statGrid}>
        <MiniStat label="Outstanding" value={peso(stats.outstanding)} tone="warn" />
        <MiniStat label="Overdue" value={peso(stats.overdue)} tone="danger" />
        <MiniStat label="Collected" value={peso(stats.collected)} tone="ok" />
        <MiniStat label="Invoices" value={stats.total ?? 0} />
      </div>

      <div className="ops-card" style={{ marginBottom: 14 }}>
        <div className="ops-filters" style={{ gap: 10, flexWrap: "wrap" }}>
          <div className="ops-search">
            <Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} />
            <input type="text" placeholder="Search invoice no, customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="ops-form-input" style={{ maxWidth: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {["draft", "sent", "partial", "paid", "void"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>

      <TableCard>
        <table className="ops-table">
          <thead>
            <tr><th>Invoice No</th><th>Customer</th><th>Date</th><th>Due</th><th style={{ textAlign: "right" }}>Total</th><th style={{ textAlign: "right" }}>Balance</th><th>Status</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7}><div className="ops-empty"><div className="ops-empty-desc">Loading…</div></div></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7}><div className="ops-empty"><div className="ops-empty-icon"><ReceiptText size={32} /></div><div className="ops-empty-title">No invoices found</div></div></td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => openDetail(r.id)}>
                <td style={{ fontWeight: 600, color: "var(--trackify-text)" }}>{r.invoiceNo}</td>
                <td>{r.customerName}</td>
                <td>{fmtDate(r.invoiceDate)}</td>
                <td style={{ color: r.balance > 0 && r.dueDate && new Date(r.dueDate) < new Date() ? "var(--danger)" : undefined }}>{fmtDate(r.dueDate)}</td>
                <td className="tk-mono" style={{ textAlign: "right" }}>{peso(r.total)}</td>
                <td className="tk-mono" style={{ textAlign: "right" }}>{peso(r.balance)}</td>
                <td><StatusPill status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      <Pager pg={pg} onPage={setPage} />

      {form && (
        <InvoiceForm
          mode={form.mode}
          data={form.data}
          customers={customers}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); load(); }}
          addToast={addToast}
        />
      )}

      {detail && (
        <Modal title={detail.invoiceNo} onClose={() => setDetail(null)} width={580}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{detail.customerName}</div>
              <div style={{ fontSize: 12, color: "var(--text-2)" }}>Issued {fmtDate(detail.invoiceDate)} · Due {fmtDate(detail.dueDate)}</div>
            </div>
            <StatusPill status={detail.status} />
          </div>
          <table className="ops-table" style={{ marginBottom: 10 }}>
            <thead><tr><th>Description</th><th style={{ textAlign: "right" }}>Qty</th><th style={{ textAlign: "right" }}>Unit</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="tk-mono" style={{ textAlign: "right" }}>{l.quantity}</td>
                  <td className="tk-mono" style={{ textAlign: "right" }}>{peso(l.unitPrice)}</td>
                  <td className="tk-mono" style={{ textAlign: "right" }}>{peso(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginLeft: "auto", width: 220, fontSize: 13 }}>
            <Row label="Subtotal" value={peso(detail.subtotal)} />
            <Row label="Tax" value={peso(detail.taxAmount)} />
            <Row label="Total" value={peso(detail.total)} bold />
            <Row label="Paid" value={peso(detail.amountPaid)} />
            <Row label="Balance" value={peso(detail.balance)} bold />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <Can permission="invoice.manage">
              {detail.status === "draft" && (
                <>
                  <button className="ops-btn ops-btn-secondary" disabled={busy} onClick={() => { setForm({ mode: "edit", data: detail }); setDetail(null); }}>Edit</button>
                  <button className="ops-btn ops-btn-primary" disabled={busy} onClick={() => act(() => invoiceApi.send(detail.id), "Invoice sent")}>Send</button>
                </>
              )}
              {["sent", "partial"].includes(detail.status) && (
                <button className="ops-btn ops-btn-primary" disabled={busy} onClick={() => setPayFor(detail)}>Record payment</button>
              )}
              {detail.status !== "paid" && detail.status !== "void" && (
                <button className="ops-btn ops-btn-ghost" disabled={busy} onClick={() => act(() => invoiceApi.void(detail.id), "Invoice voided")}>Void</button>
              )}
            </Can>
          </div>
        </Modal>
      )}

      {payFor && (
        <PaymentModal
          invoice={payFor}
          onClose={() => setPayFor(null)}
          onDone={(updated) => {
            setPayFor(null);
            if (updated) setDetail(updated);
            load();
          }}
          addToast={addToast}
        />
      )}
    </PageShell>
  );
}

function PaymentModal({ invoice, onClose, onDone, addToast }) {
  const [amount, setAmount] = useState(String(invoice.balance ?? ""));
  const [saving, setSaving] = useState(false);
  const value = Number(amount);
  const invalid = !(value > 0) || value > Number(invoice.balance) + 0.01;

  async function submit(e) {
    e.preventDefault();
    if (invalid) return;
    setSaving(true);
    try {
      const res = await invoiceApi.payment(invoice.id, value);
      addToast("Payment recorded", "success");
      onDone(res?.data?.lines ? res.data : null);
    } catch (err) {
      addToast(err.message || "Payment failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Record payment · ${invoice.invoiceNo}`} onClose={onClose} width={400}>
      <form onSubmit={submit}>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 10 }}>
          <Row label="Invoice total" value={peso(invoice.total)} />
          <Row label="Already paid" value={peso(invoice.amountPaid)} />
          <Row label="Outstanding balance" value={peso(invoice.balance)} bold />
        </div>
        <Field label="Payment amount (₱) *">
          <input
            className="ops-form-input"
            type="number"
            step="any"
            min="0"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        {value > Number(invoice.balance) + 0.01 && (
          <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>
            Amount exceeds the outstanding balance.
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" className="ops-btn ops-btn-ghost" style={{ flex: 1, fontSize: 12 }}
            onClick={() => setAmount(String(invoice.balance ?? ""))}>
            Pay full balance
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button type="button" className="ops-back-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="ops-btn ops-btn-primary" disabled={saving || invalid} style={{ borderRadius: 10 }}>
            {saving ? "Recording…" : "Record payment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Row({ label, value, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span><span className="tk-mono">{value}</span>
    </div>
  );
}

function InvoiceForm({ mode, data, customers, onClose, onSaved, addToast }) {
  const [lines, setLines] = useState(
    mode === "edit" && data?.lines?.length
      ? data.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), amount: l.amount, tripTicketId: l.tripTicketId || "" }))
      : [{ description: "", quantity: "1", unitPrice: "", amount: 0 }]
  );
  // on edit, recover the rate the invoice was built with so saving doesn't
  // silently re-tax at 12%
  const [taxRate, setTaxRate] = useState(() => {
    if (mode === "edit" && Number(data?.subtotal) > 0) {
      return String(Math.round((Number(data.taxAmount) / Number(data.subtotal)) * 10000) / 100);
    }
    return "12";
  });
  const [saving, setSaving] = useState(false);

  const subtotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const tax = subtotal * (Number(taxRate) || 0) / 100;

  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const clean = lines
      .map((l) => ({ description: l.description, quantity: Number(l.quantity) || 1, unitPrice: Number(l.unitPrice) || 0, tripTicketId: l.tripTicketId || null }))
      .filter((l) => l.description && l.unitPrice > 0);
    if (!clean.length) { addToast("Add at least one line", "error"); return; }
    const payload = {
      customerId: f.get("customerId"),
      invoiceDate: f.get("invoiceDate"),
      dueDate: f.get("dueDate"),
      notes: f.get("notes"),
      taxRate: Number(taxRate) || 0,
      lines: clean,
    };
    setSaving(true);
    try {
      if (mode === "create") await invoiceApi.create(payload);
      else await invoiceApi.update(data.id, payload);
      addToast(mode === "create" ? "Invoice created" : "Invoice updated", "success");
      onSaved();
    } catch (err) { addToast(err.message || "Save failed", "error"); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={mode === "create" ? "New Invoice" : `Edit ${data.invoiceNo}`} onClose={onClose} width={660}>
      <form onSubmit={submit}>
        <div className="ops-form-row">
          <Field label="Customer *">
            <select className="ops-form-input" name="customerId" required defaultValue={data?.customerId || ""}>
              <option value="">— select —</option>
              {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.customer_name}</option>)}
            </select>
          </Field>
          <Field label="Tax rate (%)">
            <input className="ops-form-input" type="number" step="any" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
          </Field>
        </div>
        <div className="ops-form-row">
          <Field label="Invoice date *">
            <input className="ops-form-input" type="date" name="invoiceDate" required defaultValue={data?.invoiceDate ? dateInputValue(data.invoiceDate) : todayInput()} />
          </Field>
          <Field label="Due date">
            <input className="ops-form-input" type="date" name="dueDate" defaultValue={dateInputValue(data?.dueDate)} />
          </Field>
        </div>
        <Field label="Line items *">
          <LineItems
            cols={[
              { key: "description", label: "Description" },
              { key: "quantity", label: "Qty", type: "number", width: 80 },
              { key: "unitPrice", label: "Unit price", type: "number", width: 130 },
              { key: "amount", label: "Amount", width: 120, compute: (r) => (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0) },
            ]}
            value={lines}
            onChange={setLines}
          />
        </Field>
        <div style={{ marginLeft: "auto", width: 220, fontSize: 13, margin: "8px 2px 8px auto" }}>
          <Row label="Subtotal" value={peso(subtotal)} />
          <Row label={`Tax (${taxRate || 0}%)`} value={peso(tax)} />
          <Row label="Total" value={peso(subtotal + tax)} bold />
        </div>
        <Field label="Notes"><input className="ops-form-input" name="notes" defaultValue={data?.notes || ""} /></Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <button type="button" className="ops-back-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="ops-btn ops-btn-primary" disabled={saving} style={{ borderRadius: 10 }}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
