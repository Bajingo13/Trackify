import { useMemo, useState } from "react";
import { TrendingUp, Banknote, Clock, Scale } from "lucide-react";
import AppShell from "../../components/layout/AppShell";
import { PageHeader, StatCard } from "../../components/ui";
import { useAutoRefresh } from "../../hooks/useAutoRefresh";
import { invoiceApi, expenseApi, journalApi, peso } from "../../services/finance/financeService";
import { todayInput } from "../../utils/date";
import { Bar, ReportActions, ChartCard, chartsGrid, kpiGrid, titleCase, barSheet } from "./reportKit";

const monthKey = (d) => (d ? new Date(d).toISOString().slice(0, 7) : null);
const monthLabel = (ym) => {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};
const daysBetween = (a, b) => Math.floor((new Date(a) - new Date(b)) / 86400000);

const LedgerRow = ({ label, value }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-13)" }}>
    <span style={{ color: "var(--text-2)" }}>{label}</span>
    <span className="tk-mono" style={{ fontWeight: 600, color: "var(--text)" }}>{value}</span>
  </div>
);

export default function FinancialReportsPage() {
  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [invStats, setInvStats] = useState({});
  const [jStats, setJStats] = useState({});

  const load = async () => {
    // resilient to partial permissions (e.g. report.finance without journal.read)
    const [inv, exp, is, js] = await Promise.allSettled([
      invoiceApi.list({}), expenseApi.list({}),
      invoiceApi.stats(), journalApi.stats(),
    ]);
    const val = (r, d) => (r.status === "fulfilled" ? r.value : d);
    setInvoices(val(inv, [])); setExpenses(val(exp, []));
    setInvStats(val(is, {})); setJStats(val(js, {}));
  };
  const { refreshing, lastUpdated, refresh } = useAutoRefresh(load, 60000);

  const f = useMemo(() => {
    const now = new Date();
    const billed = invoices.filter((i) => i.status !== "void").reduce((s, i) => s + (Number(i.total) || 0), 0);
    const collected = invoices.reduce((s, i) => s + (Number(i.amountPaid) || 0), 0);

    // AR aging on open balances
    const aging = { current: 0, d30: 0, d60: 0, d90: 0 };
    invoices.forEach((i) => {
      const bal = Number(i.balance ?? (Number(i.total) - Number(i.amountPaid))) || 0;
      if (bal <= 0 || i.status === "void" || i.status === "paid") return;
      const overdue = i.dueDate ? daysBetween(now, i.dueDate) : 0;
      if (overdue <= 0) aging.current += bal;
      else if (overdue <= 30) aging.d30 += bal;
      else if (overdue <= 60) aging.d60 += bal;
      else aging.d90 += bal;
    });

    const invByStatus = {};
    invoices.forEach((i) => { invByStatus[i.status] = (invByStatus[i.status] || 0) + 1; });

    // cost = trip expenses + paid vouchers that have no linked expense would double count;
    // use trip expenses as the operating-cost base, vouchers are how they're paid out.
    const cost = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const costByCat = {};
    expenses.forEach((e) => { costByCat[e.category] = (costByCat[e.category] || 0) + (Number(e.amount) || 0); });

    // revenue vs cost by month
    const rev = {}, cst = {};
    invoices.filter((i) => i.status !== "void").forEach((i) => {
      const k = monthKey(i.invoiceDate); if (k) rev[k] = (rev[k] || 0) + (Number(i.total) || 0);
    });
    expenses.forEach((e) => {
      const k = monthKey(e.expenseDate); if (k) cst[k] = (cst[k] || 0) + (Number(e.amount) || 0);
    });
    const months = [...new Set([...Object.keys(rev), ...Object.keys(cst)])].sort();

    return {
      billed, collected, outstanding: Number(invStats.outstanding) || (billed - collected), overdue: Number(invStats.overdue) || 0,
      cost, net: billed - cost,
      agingRows: [
        { key: "c", label: "Current", value: Math.round(aging.current), display: peso(aging.current), tone: "var(--accent)" },
        { key: "30", label: "1–30 days", value: Math.round(aging.d30), display: peso(aging.d30), tone: "var(--warn)" },
        { key: "60", label: "31–60 days", value: Math.round(aging.d60), display: peso(aging.d60), tone: "var(--warn)" },
        { key: "90", label: "60+ days", value: Math.round(aging.d90), display: peso(aging.d90), tone: "var(--danger)" },
      ],
      invStatusRows: Object.entries(invByStatus).map(([k, v]) => ({
        key: k, label: titleCase(k), value: v,
        tone: k === "paid" ? "var(--ok)" : k === "void" ? "var(--text-3)" : k === "overdue" ? "var(--danger)" : "var(--accent)",
      })),
      costCatRows: Object.entries(costByCat).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => ({ key: k, label: titleCase(k), value: Math.round(v), display: peso(v) })),
      revRows: months.map((k) => ({ key: `r${k}`, label: monthLabel(k), value: Math.round(rev[k] || 0), display: peso(rev[k] || 0), tone: "var(--ok)" })),
      cstRows: months.map((k) => ({ key: `c${k}`, label: monthLabel(k), value: Math.round(cst[k] || 0), display: peso(cst[k] || 0), tone: "var(--danger)" })),
      journalPosted: jStats.posted ?? 0,
      journalDraft: jStats.draft ?? 0,
      journalValue: jStats.postedValue ?? 0,
    };
  }, [invoices, expenses, invStats, jStats]);

  const buildExport = () => ({
    filename: `Financial Report ${todayInput()}`,
    title: "AstreaBlue Trackify — Financial Report",
    meta: [["Generated", new Date().toLocaleString()]],
    sheets: [
      { name: "Summary", rows: [
        ["Metric", "Value"],
        ["Billed (non-void invoices)", peso(f.billed)],
        ["Collected", peso(f.collected)],
        ["Outstanding AR", peso(f.outstanding)],
        ["Overdue", peso(f.overdue)],
        ["Operating cost", peso(f.cost)],
        ["Net position", peso(f.net)],
        ["Journal entries posted", f.journalPosted],
        ["Journal entries draft", f.journalDraft],
        ["Posted ledger value", peso(f.journalValue)],
      ] },
      barSheet("AR aging", ["Bucket", "Amount (PHP)"], f.agingRows),
      barSheet("Invoices by status", ["Status", "Count"], f.invStatusRows),
      barSheet("Operating cost by category", ["Category", "Amount (PHP)"], f.costCatRows),
      barSheet("Revenue by month", ["Month", "Amount (PHP)"], f.revRows),
      barSheet("Cost by month", ["Month", "Amount (PHP)"], f.cstRows),
    ],
  });

  return (
    <AppShell pageKey="reports-financial">
      <PageHeader
        eyebrow="Reports"
        title="Financial Report"
        subtitle="Receivables, collections, operating cost and the resulting position"
        actions={<ReportActions build={buildExport} refreshing={refreshing} lastUpdated={lastUpdated} onRefresh={refresh} />}
      />

      <div style={kpiGrid}>
        <StatCard index={0} label="Billed (₱)" value={Math.round(f.billed)} icon={TrendingUp} tone="accent" hint="non-void invoices" />
        <StatCard index={1} label="Collected (₱)" value={Math.round(f.collected)} icon={Banknote} tone="ok" />
        <StatCard index={2} label="Outstanding AR (₱)" value={Math.round(f.outstanding)} icon={Clock} tone={f.overdue > 0 ? "danger" : "warn"} hint={f.overdue > 0 ? `${peso(f.overdue)} overdue` : "none overdue"} />
        <StatCard index={3} label="Operating cost (₱)" value={Math.round(f.cost)} icon={Scale} tone="accent" hint={`net ${peso(f.net)}`} />
      </div>

      <div style={chartsGrid}>
        <ChartCard title="Accounts-receivable aging" footer={`Outstanding ${peso(f.outstanding)}`}>
          <Bar rows={f.agingRows} />
        </ChartCard>
        <ChartCard title="Invoices by status">
          <Bar rows={f.invStatusRows} />
        </ChartCard>
        <ChartCard title="Operating cost by category">
          <Bar rows={f.costCatRows} tone="var(--danger)" />
        </ChartCard>
        <ChartCard title="General ledger" footer="Posted journal entries feed the general ledger.">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <LedgerRow label="Posted entries" value={f.journalPosted} />
            <LedgerRow label="Draft entries" value={f.journalDraft} />
            <LedgerRow label="Posted value" value={peso(f.journalValue)} />
          </div>
        </ChartCard>
        <ChartCard title="Revenue by month" wide>
          <Bar rows={f.revRows} tone="var(--ok)" />
        </ChartCard>
        <ChartCard title="Cost by month" wide>
          <Bar rows={f.cstRows} tone="var(--danger)" />
        </ChartCard>
      </div>
    </AppShell>
  );
}
