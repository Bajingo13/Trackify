import { useState, useEffect, useCallback } from "react";
import { Plus, Search, BookOpen } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import { PageShell, StatusPill, Modal, Field, TableCard } from "../../components/shared/crud";
import { Can } from "../../auth/permissions";
import LineItems from "./_LineItems";
import { MiniStat, statGrid, fmtDate, Pager } from "./_bits";
import { dateInputValue, todayInput } from "../../utils/date";
import { journalApi, peso } from "../../services/finance/financeService";
import { accountService } from "../../services/masterDataService";

export default function JournalEntriesPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({});
  const [accounts, setAccounts] = useState([]);
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
      const [res, st] = await Promise.all([journalApi.listPage({ search, status, page, limit: 25 }), journalApi.stats()]);
      setRows(res.data); setPg(res.pagination); setStats(st);
    } catch (e) { addToast(e.message || "Failed to load journal", "error"); }
    finally { setLoading(false); }
  }, [search, status, page, addToast]);

  useEffect(() => { setPage(1); }, [search, status]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { accountService.list().then((r) => setAccounts(r.filter((a) => a.status === "active"))).catch(() => {}); }, []);

  async function openDetail(id) {
    try { setDetail(await journalApi.get(id)); }
    catch (e) { addToast(e.message || "Failed to load entry", "error"); }
  }
  async function act(fn, okMsg) {
    setBusy(true);
    try {
      const res = await fn();
      addToast(okMsg, "success");
      // post/void return the refreshed entry (has .lines); delete returns
      // just { id } — close the modal in that case.
      if (res?.data?.lines) setDetail(res.data);
      else setDetail(null);
      load();
    } catch (e) { addToast(e.message || "Action failed", "error"); }
    finally { setBusy(false); }
  }

  return (
    <PageShell
      title="Journal Entries"
      subtitle="General-ledger postings against the chart of accounts"
      actions={
        <Can permission="journal.manage">
          <button className="ops-btn ops-btn-primary" onClick={() => setForm({ mode: "create" })}><Plus size={15} /> New Entry</button>
        </Can>
      }
    >
      <div style={statGrid}>
        <MiniStat label="Draft" value={stats.draft ?? 0} tone="warn" />
        <MiniStat label="Posted" value={stats.posted ?? 0} tone="ok" />
        <MiniStat label="Posted value" value={peso(stats.postedValue)} />
        <MiniStat label="Total" value={stats.total ?? 0} />
      </div>

      <div className="ops-card" style={{ marginBottom: 14 }}>
        <div className="ops-filters" style={{ gap: 10, flexWrap: "wrap" }}>
          <div className="ops-search">
            <Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} />
            <input type="text" placeholder="Search entry no, memo, reference…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="ops-form-input" style={{ maxWidth: 160 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {["draft", "posted", "void"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>

      <TableCard>
        <table className="ops-table">
          <thead>
            <tr><th>Entry No</th><th>Date</th><th>Memo</th><th>Reference</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6}><div className="ops-empty"><div className="ops-empty-desc">Loading…</div></div></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6}><div className="ops-empty"><div className="ops-empty-icon"><BookOpen size={32} /></div><div className="ops-empty-title">No journal entries</div></div></td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => openDetail(r.id)}>
                <td style={{ fontWeight: 600, color: "var(--trackify-text)" }}>{r.entryNo}</td>
                <td>{fmtDate(r.entryDate)}</td>
                <td>{r.memo || "—"}</td>
                <td>{r.reference || "—"}</td>
                <td className="tk-mono" style={{ textAlign: "right" }}>{peso(r.totalDebit)}</td>
                <td><StatusPill status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      <Pager pg={pg} onPage={setPage} />

      {form && (
        <EntryForm
          mode={form.mode}
          data={form.data}
          accounts={accounts}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); load(); }}
          addToast={addToast}
        />
      )}

      {detail && (
        <Modal title={detail.entryNo} onClose={() => setDetail(null)} width={620}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{detail.memo || "—"}</div>
              <div style={{ fontSize: 12, color: "var(--text-2)" }}>{fmtDate(detail.entryDate)}{detail.reference ? ` · ${detail.reference}` : ""}</div>
            </div>
            <StatusPill status={detail.status} />
          </div>
          <table className="ops-table" style={{ marginBottom: 10 }}>
            <thead><tr><th>Account</th><th>Description</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Credit</th></tr></thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.accountCode} · {l.accountName}</td>
                  <td>{l.description || "—"}</td>
                  <td className="tk-mono" style={{ textAlign: "right" }}>{l.debit ? peso(l.debit) : "—"}</td>
                  <td className="tk-mono" style={{ textAlign: "right" }}>{l.credit ? peso(l.credit) : "—"}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={2}>Totals</td>
                <td className="tk-mono" style={{ textAlign: "right" }}>{peso(detail.totalDebit)}</td>
                <td className="tk-mono" style={{ textAlign: "right" }}>{peso(detail.totalCredit)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Can permission="journal.manage">
              {detail.status === "draft" && (
                <>
                  <button className="ops-btn ops-btn-ghost" disabled={busy} onClick={() => act(() => journalApi.remove(detail.id), "Entry deleted")}>Delete</button>
                  <button className="ops-btn ops-btn-secondary" disabled={busy} onClick={() => { setForm({ mode: "edit", data: detail }); setDetail(null); }}>Edit</button>
                  <button className="ops-btn ops-btn-primary" disabled={busy} onClick={() => act(() => journalApi.post(detail.id), "Entry posted")}>Post</button>
                </>
              )}
              {detail.status === "posted" && (
                <button className="ops-btn ops-btn-secondary" disabled={busy} onClick={() => act(() => journalApi.void(detail.id), "Entry voided")}>Void</button>
              )}
            </Can>
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

function EntryForm({ mode, data, accounts, onClose, onSaved, addToast }) {
  const editing = mode === "edit";
  const [lines, setLines] = useState(
    editing && data?.lines?.length
      ? data.lines.map((l) => ({ accountId: String(l.accountId), description: l.description || "", debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "" }))
      : [{ accountId: "", description: "", debit: "", credit: "" }, { accountId: "", description: "", debit: "", credit: "" }]
  );
  const [saving, setSaving] = useState(false);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01;

  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const clean = lines
      .map((l) => ({ accountId: Number(l.accountId), description: l.description, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }))
      .filter((l) => l.accountId && (l.debit > 0 || l.credit > 0));
    if (clean.length < 2) { addToast("Add at least two lines", "error"); return; }
    if (!balanced) { addToast("Debits and credits must balance", "error"); return; }
    const payload = { entryDate: f.get("entryDate"), memo: f.get("memo"), reference: f.get("reference"), lines: clean };
    setSaving(true);
    try {
      if (editing) {
        await journalApi.update(data.id, payload);
        addToast("Journal entry updated", "success");
      } else {
        await journalApi.create(payload);
        addToast("Journal entry created", "success");
      }
      onSaved();
    } catch (err) { addToast(err.message || "Save failed", "error"); }
    finally { setSaving(false); }
  }

  const accOpts = accounts.map((a) => ({ value: String(a.account_id), label: `${a.account_code} · ${a.account_name}` }));

  return (
    <Modal title={editing ? `Edit ${data.entryNo}` : "New Journal Entry"} onClose={onClose} width={720}>
      <form onSubmit={submit}>
        <div className="ops-form-row">
          <Field label="Entry date *"><input className="ops-form-input" type="date" name="entryDate" required defaultValue={data?.entryDate ? dateInputValue(data.entryDate) : todayInput()} /></Field>
          <Field label="Reference"><input className="ops-form-input" name="reference" defaultValue={data?.reference || ""} /></Field>
        </div>
        <Field label="Memo"><input className="ops-form-input" name="memo" defaultValue={data?.memo || ""} /></Field>
        <Field label="Lines *">
          <LineItems
            cols={[
              { key: "accountId", label: "Account", options: accOpts, width: 240 },
              { key: "description", label: "Description" },
              { key: "debit", label: "Debit", type: "number", width: 110 },
              { key: "credit", label: "Credit", type: "number", width: 110 },
            ]}
            value={lines}
            onChange={setLines}
          />
        </Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 18, margin: "8px 2px", fontWeight: 700 }}>
          <span>Debit <span className="tk-mono">{peso(totalDebit)}</span></span>
          <span>Credit <span className="tk-mono">{peso(totalCredit)}</span></span>
          <span style={{ color: balanced ? "var(--ok)" : "var(--danger)" }}>{balanced ? "Balanced" : "Out of balance"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <button type="button" className="ops-back-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="ops-btn ops-btn-primary" disabled={saving || !balanced} style={{ borderRadius: 10 }}>{saving ? "Saving…" : editing ? "Save changes" : "Create entry"}</button>
        </div>
      </form>
    </Modal>
  );
}
