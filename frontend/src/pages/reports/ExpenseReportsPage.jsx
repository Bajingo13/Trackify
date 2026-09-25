import { useEffect, useState } from "react";
import { Wallet, ReceiptText, HandCoins, ListChecks } from "lucide-react";
import AppShell from "../../components/layout/AppShell";
import { PageHeader, StatCard } from "../../components/ui";
import { useAutoRefresh } from "../../hooks/useAutoRefresh";
import { getExpenseReport } from "../../services/reports/reportsService";
import { peso } from "../../services/finance/financeService";
import { todayInput } from "../../utils/date";
import LoadFailure, { StaleData } from "../../components/shared/LoadFailure";
import {
  Bar, RangeCard, ReportActions, ChartCard, barSheet,
  chartsGrid, kpiGrid,
} from "./reportKit";

/**
 * Expense report.
 *
 * Counted by the database. This page used to fetch every trip expense and every
 * voucher and total them here, on load and again each minute; it now asks for
 * the figures, and the date range is applied in SQL rather than by discarding
 * most of what was just downloaded.
 */
const monthLabel = (ym) => {
  const [y, m] = String(ym).split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};

/* The voucher pipeline reads as a sequence, so every stage is shown even when
   empty — a missing "Rejected" bar and a zero one say different things. */
const VOUCHER_STAGES = [
  { key: "draft", label: "Draft", tone: "var(--st-draft, var(--text-3))" },
  { key: "submitted", label: "Submitted", tone: "var(--warn)" },
  { key: "approved", label: "Approved", tone: "var(--accent)" },
  { key: "rejected", label: "Rejected", tone: "var(--danger)" },
  { key: "paid", label: "Paid", tone: "var(--ok)" },
];

const EMPTY = {
  count: 0, total: 0, unvouchered: 0, reimbursed: 0,
  categoryRows: [], monthRows: [], tripRows: [], voucherRows: [], vouchersPaid: 0,
};

const withPeso = (rows, label) =>
  rows.map((r) => ({ ...r, label: label ? label(r.key) : r.label, display: peso(r.value) }));

export default function ExpenseReportsPage() {
  const [data, setData] = useState(EMPTY);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = async () => setData(await getExpenseReport({ from, to }));
  const { refreshing, lastUpdated, refresh, error, loaded } = useAutoRefresh(load, 60000);

  // The range is applied in SQL now, so changing it has to ask again.
  useEffect(() => { refresh(); }, [from, to, refresh]);

  const x = data || EMPTY;
  const catRows = withPeso(x.categoryRows || []);
  const monthRows = withPeso(x.monthRows || [], monthLabel);
  const tripRows = withPeso(x.tripRows || []);

  const byStage = new Map((x.voucherRows || []).map((r) => [r.key, r.value]));
  const voucherRows = VOUCHER_STAGES.map((s) => ({ ...s, value: byStage.get(s.key) || 0 }));

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
        ["Vouchers paid to date", peso(x.vouchersPaid)],
      ] },
      barSheet("By category", ["Category", "Amount (PHP)"], catRows),
      barSheet("By month", ["Month", "Amount (PHP)"], monthRows),
      barSheet("Top trips by cost", ["Trip", "Amount (PHP)"], tripRows),
      barSheet("Voucher pipeline", ["Status", "Count"], voucherRows),
    ],
  });

  /*
   * Nothing has ever arrived and the last attempt failed, so there are no
   * figures to show. Falling through to the page below would render EMPTY as
   * ₱0.00 across every tile — an answer, and a wrong one.
   */
  if (!loaded && error) {
    return (
      <AppShell pageKey="reports-expenses">
        <PageHeader eyebrow="Reports" title="Expense Report" />
        <LoadFailure error={error} onRetry={refresh} retrying={refreshing} what="the expense report" />
      </AppShell>
    );
  }

  return (
    <AppShell pageKey="reports-expenses">
      <PageHeader
        eyebrow="Reports"
        title="Expense Report"
        subtitle="Trip cost breakdown and the reimbursement voucher pipeline"
        actions={<ReportActions build={buildExport} refreshing={refreshing} lastUpdated={lastUpdated} onRefresh={refresh} />}
      />

      {/* Figures are on screen but the newest refresh failed: keep them, and
          say how old they are rather than presenting them as current. */}
      {error && (
        <StaleData error={error} onRetry={refresh} retrying={refreshing} lastUpdated={lastUpdated} />
      )}

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
          <Bar rows={catRows} />
        </ChartCard>
        <ChartCard title="Expense by month">
          <Bar rows={monthRows} tone="var(--st-transit, var(--accent))" />
        </ChartCard>
        <ChartCard title="Voucher pipeline" footer={`Paid to date ${peso(x.vouchersPaid)}`}>
          <Bar rows={voucherRows} />
        </ChartCard>
        <ChartCard title="Top trips by cost" wide footer="Expenses not tied to a trip are grouped as “Unassigned”.">
          <Bar rows={tripRows} tone="var(--warn)" />
        </ChartCard>
      </div>
    </AppShell>
  );
}
