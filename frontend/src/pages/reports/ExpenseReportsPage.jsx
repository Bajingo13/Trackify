import { useMemo, useState } from "react";
import { Wallet, ReceiptText, HandCoins, ListChecks } from "lucide-react";
import AppShell from "../../components/layout/AppShell";
import { PageHeader, StatCard } from "../../components/ui";
import { useAutoRefresh } from "../../hooks/useAutoRefresh";
import { expenseApi, voucherApi, peso } from "../../services/finance/financeService";
import { todayInput } from "../../utils/date";
import {
  Bar, RangeCard, ReportActions, ChartCard, makeInRange, barSheet,
  chartsGrid, kpiGrid, titleCase,
} from "./reportKit";

const month = (d) => (d ? new Date(d).toISOString().slice(0, 7) : "—");
const monthLabel = (ym) => {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};

export default function ExpenseReportsPage() {
  const [expenses, setExpenses] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = async () => {
    // resilient: a user with report.finance but not voucher.read still gets the
    // expense charts rather than a blank page.
    const [e, v] = await Promise.allSettled([expenseApi.list({}), voucherApi.list({})]);
    setExpenses(e.status === "fulfilled" ? e.value : []);
    setVouchers(v.status === "fulfilled" ? v.value : []);
  };
  const { refreshing, lastUpdated, refresh } = useAutoRefresh(load, 60000);

  const inRange = makeInRange(from, to);

  const x = useMemo(() => {
    const rows = (from || to) ? expenses.filter((r) => inRange(r.expenseDate)) : expenses;

    const byCat = {};
    const byMonth = {};
    const byTrip = {};
    let total = 0, reimbursed = 0, unvouchered = 0;
    rows.forEach((r) => {
      const amt = Number(r.amount) || 0;
      total += amt;
      if (r.status === "reimbursed") reimbursed += amt;
      if (r.status === "recorded") unvouchered += amt;
      byCat[r.category] = (byCat[r.category] || 0) + amt;
      byMonth[month(r.expenseDate)] = (byMonth[month(r.expenseDate)] || 0) + amt;
      const t = r.tripNo || "Unassigned";
      byTrip[t] = (byTrip[t] || 0) + amt;
    });

    const vRows = (from || to) ? vouchers.filter((v) => inRange(v.createdAt)) : vouchers;
    const vStatus = { draft: 0, submitted: 0, approved: 0, rejected: 0, paid: 0 };
    let vPaid = 0;
    vRows.forEach((v) => {
      vStatus[v.status] = (vStatus[v.status] || 0) + 1;
      if (v.status === "paid") vPaid += Number(v.totalAmount) || 0;
    });

    return {
      total, reimbursed, unvouchered, count: rows.length,
      catRows: Object.entries(byCat).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => ({ key: k, label: titleCase(k), value: Math.round(v), display: peso(v) })),
      monthRows: Object.keys(byMonth).sort().map((k) => ({ key: k, label: monthLabel(k), value: Math.round(byMonth[k]), display: peso(byMonth[k]) })),
      tripRows: Object.entries(byTrip).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, v]) => ({ key: k, label: k, value: Math.round(v), display: peso(v) })),
      voucherRows: [
        { key: "d", label: "Draft", value: vStatus.draft, tone: "var(--st-draft, var(--text-3))" },
        { key: "s", label: "Submitted", value: vStatus.submitted, tone: "var(--warn)" },
        { key: "a", label: "Approved", value: vStatus.approved, tone: "var(--accent)" },
        { key: "r", label: "Rejected", value: vStatus.rejected, tone: "var(--danger)" },
        { key: "p", label: "Paid", value: vStatus.paid, tone: "var(--ok)" },
      ],
      vPaid,
    };
  }, [expenses, vouchers, from, to]);

  const buildExport = () => ({
    filename: `Expense Report ${todayInput()}`,
    title: "AstreaBlue Trackify — Expense Report",
    meta: [
      ["Generated", new Date().toLocaleString()],
      ["Date range", (from || to) ? `${from || "start"} to ${to || "today"}` : "All time"],
      ["Expense entries", x.count],
    ],
    sheets: [
      { name: "Summary", rows: [
        ["Metric", "Value"],
        ["Total expense", peso(x.total)],
        ["Not yet vouchered", peso(x.unvouchered)],
        ["Reimbursed", peso(x.reimbursed)],
        ["Vouchers paid to date", peso(x.vPaid)],
      ] },
      barSheet("By category", ["Category", "Amount (PHP)"], x.catRows),
      barSheet("By month", ["Month", "Amount (PHP)"], x.monthRows),
      barSheet("Top trips by cost", ["Trip", "Amount (PHP)"], x.tripRows),
      barSheet("Voucher pipeline", ["Status", "Count"], x.voucherRows),
    ],
  });

  return (
    <AppShell pageKey="reports-expenses">
      <PageHeader
        eyebrow="Reports"
        title="Expense Report"
        subtitle="Trip cost breakdown and the reimbursement voucher pipeline"
        actions={<ReportActions build={buildExport} refreshing={refreshing} lastUpdated={lastUpdated} onRefresh={refresh} />}
      />

      <RangeCard
        from={from} to={to} setFrom={setFrom} setTo={setTo}
        summary={`${x.count} expenses${(from || to) ? " in range" : ""}`}
      />

      <div style={kpiGrid}>
        <StatCard index={0} label="Total expense (₱)" value={Math.round(x.total)} icon={Wallet} tone="accent" />
        <StatCard index={1} label="Not vouchered (₱)" value={Math.round(x.unvouchered)} icon={ReceiptText} tone={x.unvouchered > 0 ? "warn" : "ok"} />
        <StatCard index={2} label="Reimbursed (₱)" value={Math.round(x.reimbursed)} icon={HandCoins} tone="ok" />
        <StatCard index={3} label="Expense entries" value={x.count} icon={ListChecks} tone="accent" />
      </div>

      <div style={chartsGrid}>
        <ChartCard title="Expense by category" footer={`Total ${peso(x.total)}`}>
          <Bar rows={x.catRows} />
        </ChartCard>
        <ChartCard title="Expense by month">
          <Bar rows={x.monthRows} tone="var(--st-transit, var(--accent))" />
        </ChartCard>
        <ChartCard title="Voucher pipeline" footer={`Paid to date ${peso(x.vPaid)}`}>
          <Bar rows={x.voucherRows} />
        </ChartCard>
        <ChartCard title="Top trips by cost" wide footer="Expenses not tied to a trip are grouped as “Unassigned”.">
          <Bar rows={x.tripRows} tone="var(--warn)" />
        </ChartCard>
      </div>
    </AppShell>
  );
}
