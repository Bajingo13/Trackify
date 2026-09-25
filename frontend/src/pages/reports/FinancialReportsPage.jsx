import LoadFailure, { StaleData } from "../../components/shared/LoadFailure";
import { useState } from "react";
import { TrendingUp, Banknote, Clock, Scale } from "lucide-react";
import AppShell from "../../components/layout/AppShell";
import { PageHeader, StatCard } from "../../components/ui";
import { useAutoRefresh } from "../../hooks/useAutoRefresh";
import { getFinancialReport } from "../../services/reports/reportsService";
import { peso } from "../../services/finance/financeService";
import { todayInput } from "../../utils/date";
import { Bar, ReportActions, ChartCard, chartsGrid, kpiGrid, barSheet } from "./reportKit";

/**
 * Financial report.
 *
 * Counted by the database. This page used to fetch every invoice and every
 * expense and total them here — receivable ageing included — on load and again
 * each minute.
 *
 * One figure is deliberately not the same as the Invoices screen's: `collected`
 * here is every peso actually received, part-payments included, where that
 * screen counts an invoice only once it is fully paid. This report has always
 * meant the former, and the two diverge the moment a customer pays half.
 */
const monthLabel = (ym) => {
  const [y, m] = String(ym).split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};

const AGING_TONE = {
  current: "var(--accent)",
  d30: "var(--warn)",
  d60: "var(--warn)",
  d90: "var(--danger)",
};

const INVOICE_TONE = {
  paid: "var(--ok)",
  void: "var(--text-3)",
  overdue: "var(--danger)",
};

const LedgerRow = ({ label, value }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-13)" }}>
    <span style={{ color: "var(--text-2)" }}>{label}</span>
    <span className="tk-mono" style={{ fontWeight: 600, color: "var(--text)" }}>{value}</span>
  </div>
);

const EMPTY = {
  billed: 0, collected: 0, outstanding: 0, overdue: 0, cost: 0, net: 0,
  agingRows: [], invoiceStatusRows: [], costCategoryRows: [],
  revenueByMonth: [], costByMonth: [],
  journal: { draft: 0, posted: 0, postedValue: 0 },
};

export default function FinancialReportsPage() {
  const [data, setData] = useState(EMPTY);

  const load = async () => setData(await getFinancialReport());
  const { refreshing, lastUpdated, refresh, error, loaded } = useAutoRefresh(load, 60000);

  const f = data || EMPTY;
  const journal = f.journal || EMPTY.journal;

  const agingRows = (f.agingRows || []).map((r) => ({
    ...r, display: peso(r.value), tone: AGING_TONE[r.key],
  }));
  const invStatusRows = (f.invoiceStatusRows || []).map((r) => ({
    ...r, tone: INVOICE_TONE[r.key] || "var(--accent)",
  }));
  const costCatRows = (f.costCategoryRows || []).map((r) => ({ ...r, display: peso(r.value) }));
  const revRows = (f.revenueByMonth || []).map((r) => ({
    ...r, label: monthLabel(r.key), display: peso(r.value), tone: "var(--ok)",
  }));
  const cstRows = (f.costByMonth || []).map((r) => ({
    ...r, label: monthLabel(r.key), display: peso(r.value), tone: "var(--danger)",
  }));

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
        ["Journal entries posted", journal.posted],
        ["Journal entries draft", journal.draft],
        ["Posted ledger value", peso(journal.postedValue)],
      ] },
      barSheet("AR aging", ["Bucket", "Amount (PHP)"], agingRows),
      barSheet("Invoices by status", ["Status", "Count"], invStatusRows),
      barSheet("Operating cost by category", ["Category", "Amount (PHP)"], costCatRows),
      barSheet("Revenue by month", ["Month", "Amount (PHP)"], revRows),
      barSheet("Cost by month", ["Month", "Amount (PHP)"], cstRows),
    ],
  });

  /*
   * Nothing has ever arrived and the last attempt failed. Rendering the page
   * below would show this screen's empty defaults — zeros that read as real
   * figures — so it says plainly that nothing was loaded.
   */
  if (!loaded && error) {
    return (
      <AppShell pageKey="reports-financial">
        <PageHeader eyebrow="Reports" title="Financial Report" />
        <LoadFailure error={error} onRetry={refresh} retrying={refreshing} what="the financial report" />
      </AppShell>
    );
  }

  return (
    <AppShell pageKey="reports-financial">
      <PageHeader
        eyebrow="Reports"
        title="Financial Report"
        subtitle="Receivables, collections, operating cost and the resulting position"
        actions={<ReportActions build={buildExport} refreshing={refreshing} lastUpdated={lastUpdated} onRefresh={refresh} />}
      />

        {/* Figures are on screen but the newest refresh failed: keep them,
            and say how old they are rather than implying they are current. */}
        {error && (
          <StaleData error={error} onRetry={refresh} retrying={refreshing} lastUpdated={lastUpdated} />
        )}

      <div style={kpiGrid}>
        <StatCard index={0} label="Billed (₱)" value={Math.round(f.billed)} icon={TrendingUp} tone="accent" hint="non-void invoices" />
        <StatCard index={1} label="Collected (₱)" value={Math.round(f.collected)} icon={Banknote} tone="ok" hint="part-payments included" />
        <StatCard index={2} label="Outstanding AR (₱)" value={Math.round(f.outstanding)} icon={Clock} tone={f.overdue > 0 ? "danger" : "warn"} hint={f.overdue > 0 ? `${peso(f.overdue)} overdue` : "none overdue"} />
        <StatCard index={3} label="Operating cost (₱)" value={Math.round(f.cost)} icon={Scale} tone="accent" hint={`net ${peso(f.net)}`} />
      </div>

      <div style={chartsGrid}>
        <ChartCard title="Accounts-receivable aging" footer={`Outstanding ${peso(f.outstanding)}`}>
          <Bar rows={agingRows} />
        </ChartCard>
        <ChartCard title="Invoices by status">
          <Bar rows={invStatusRows} />
        </ChartCard>
        <ChartCard title="Operating cost by category">
          <Bar rows={costCatRows} tone="var(--danger)" />
        </ChartCard>
        <ChartCard title="General ledger" footer="Posted journal entries feed the general ledger.">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <LedgerRow label="Posted entries" value={journal.posted} />
            <LedgerRow label="Draft entries" value={journal.draft} />
            <LedgerRow label="Posted value" value={peso(journal.postedValue)} />
          </div>
        </ChartCard>
        <ChartCard title="Revenue by month" wide>
          <Bar rows={revRows} tone="var(--ok)" />
        </ChartCard>
        <ChartCard title="Cost by month" wide>
          <Bar rows={cstRows} tone="var(--danger)" />
        </ChartCard>
      </div>
    </AppShell>
  );
}
