/**
 * The two money reports, counted by the database.
 *
 * Expense and Financial both totalled their figures in the browser: the expense
 * screen fetched every trip expense and every voucher, the financial screen
 * every invoice and every expense, on load and again each minute. Neither page
 * needs the rows — only the totals drawn on the charts.
 *
 * Both are scoped by company alone, not company and branch, because that is how
 * the finance screens behind them scope: expenses.controller, invoices,
 * vouchers and journal all filter on company_id only. A report that narrowed
 * further would quietly disagree with the screen it came from.
 *
 * Kept apart from reports.controller so the fleet and operations counting is
 * not disturbed; the shared helpers come from there rather than being copied.
 */
import db from "../../config/db.js";
import { range, rows, money, titleCase } from "./reports.controller.js";

/* ---------------------------------------------------------------- */
/* Expenses                                                         */
/* ---------------------------------------------------------------- */

export async function expenseReport(req, res) {
  const { companyId } = req.context;
  const spent = range("e.expense_date", req);
  const raised = range("v.created_at", req);

  const [
    [summary],
    [byCategory],
    [byMonth],
    [byTrip],
    [voucherStatus],
    [voucherPaid],
  ] = await Promise.all([
    db.execute(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(e.amount), 0) AS total,
              COALESCE(SUM(CASE WHEN e.status = 'recorded' THEN e.amount ELSE 0 END), 0) AS unvouchered,
              COALESCE(SUM(CASE WHEN e.status = 'reimbursed' THEN e.amount ELSE 0 END), 0) AS reimbursed
         FROM trip_expenses e WHERE e.company_id = ?${spent.sql}`,
      [companyId, ...spent.params]
    ),
    db.execute(
      `SELECT e.category AS k, COALESCE(SUM(e.amount), 0) AS c
         FROM trip_expenses e WHERE e.company_id = ?${spent.sql}
        GROUP BY e.category ORDER BY c DESC`,
      [companyId, ...spent.params]
    ),
    db.execute(
      `SELECT DATE_FORMAT(e.expense_date, '%Y-%m') AS k, COALESCE(SUM(e.amount), 0) AS c
         FROM trip_expenses e WHERE e.company_id = ?${spent.sql}
        GROUP BY k ORDER BY k`,
      [companyId, ...spent.params]
    ),
    // An expense with no trip is still real money. Grouping it keeps the
    // per-trip chart adding up to the total printed directly above it.
    db.execute(
      `SELECT COALESCE(tt.ticket_no, 'Unassigned') AS k, COALESCE(SUM(e.amount), 0) AS c
         FROM trip_expenses e
         LEFT JOIN trip_tickets tt ON tt.trip_ticket_id = e.trip_ticket_id
        WHERE e.company_id = ?${spent.sql}
        GROUP BY k ORDER BY c DESC LIMIT 8`,
      [companyId, ...spent.params]
    ),
    db.execute(
      `SELECT v.status AS k, COUNT(*) AS c
         FROM expense_vouchers v WHERE v.company_id = ?${raised.sql}
        GROUP BY v.status`,
      [companyId, ...raised.params]
    ),
    db.execute(
      `SELECT COALESCE(SUM(v.total_amount), 0) AS paid
         FROM expense_vouchers v
        WHERE v.company_id = ? AND v.status = 'paid'${raised.sql}`,
      [companyId, ...raised.params]
    ),
  ]);

  const s = summary[0] || {};

  res.json({
    success: true,
    data: {
      count: Number(s.count || 0),
      total: Number(s.total || 0),
      unvouchered: Number(s.unvouchered || 0),
      reimbursed: Number(s.reimbursed || 0),
      categoryRows: money(byCategory),
      // The month key stays sortable; the page turns it into "Sep 26".
      monthRows: money(byMonth, (k) => k),
      tripRows: money(byTrip, (k) => k),
      voucherRows: rows(voucherStatus, titleCase),
      vouchersPaid: Number(voucherPaid[0]?.paid || 0),
      range: { from: spent.from, to: spent.to, applied: spent.applied },
    },
  });
}

/* ---------------------------------------------------------------- */
/* Financial                                                        */
/* ---------------------------------------------------------------- */

export async function financialReport(req, res) {
  const { companyId } = req.context;

  const [
    [invoiceSummary],
    [aging],
    [invoiceStatus],
    [cost],
    [costByCategory],
    [revenueByMonth],
    [costByMonth],
    [journal],
  ] = await Promise.all([
    // `collected` is every peso actually received, part-payments included. The
    // invoices screen counts an invoice only once it is fully paid; the two
    // answers diverge the moment a customer pays half, and this report has
    // always meant the former.
    db.execute(
      `SELECT
         COALESCE(SUM(CASE WHEN i.status <> 'void' THEN i.total ELSE 0 END), 0) AS billed,
         COALESCE(SUM(i.amount_paid), 0) AS collected,
         COALESCE(SUM(CASE WHEN i.status NOT IN ('paid','void')
                           THEN i.total - i.amount_paid ELSE 0 END), 0) AS outstanding,
         COALESCE(SUM(CASE WHEN i.status NOT IN ('paid','void') AND i.due_date < CURDATE()
                           THEN i.total - i.amount_paid ELSE 0 END), 0) AS overdue
       FROM invoices i WHERE i.company_id = ?`,
      [companyId]
    ),
    // Aged on what is still owed. An invoice with no due date cannot be
    // overdue, so it sits in current rather than being guessed at.
    db.execute(
      `SELECT
         COALESCE(SUM(CASE WHEN i.due_date IS NULL OR DATEDIFF(CURDATE(), i.due_date) <= 0
                           THEN i.total - i.amount_paid ELSE 0 END), 0) AS current,
         COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 1 AND 30
                           THEN i.total - i.amount_paid ELSE 0 END), 0) AS d30,
         COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 31 AND 60
                           THEN i.total - i.amount_paid ELSE 0 END), 0) AS d60,
         COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) > 60
                           THEN i.total - i.amount_paid ELSE 0 END), 0) AS d90
       FROM invoices i
      WHERE i.company_id = ? AND i.status NOT IN ('paid','void')
        AND i.total - i.amount_paid > 0`,
      [companyId]
    ),
    db.execute(
      `SELECT i.status AS k, COUNT(*) AS c
         FROM invoices i WHERE i.company_id = ? GROUP BY i.status`,
      [companyId]
    ),
    db.execute(
      `SELECT COALESCE(SUM(e.amount), 0) AS cost
         FROM trip_expenses e WHERE e.company_id = ?`,
      [companyId]
    ),
    db.execute(
      `SELECT e.category AS k, COALESCE(SUM(e.amount), 0) AS c
         FROM trip_expenses e WHERE e.company_id = ?
        GROUP BY e.category ORDER BY c DESC`,
      [companyId]
    ),
    db.execute(
      `SELECT DATE_FORMAT(i.invoice_date, '%Y-%m') AS k, COALESCE(SUM(i.total), 0) AS c
         FROM invoices i WHERE i.company_id = ? AND i.status <> 'void'
        GROUP BY k ORDER BY k`,
      [companyId]
    ),
    db.execute(
      `SELECT DATE_FORMAT(e.expense_date, '%Y-%m') AS k, COALESCE(SUM(e.amount), 0) AS c
         FROM trip_expenses e WHERE e.company_id = ?
        GROUP BY k ORDER BY k`,
      [companyId]
    ),
    db.execute(
      `SELECT
         COALESCE(SUM(CASE WHEN j.status = 'draft' THEN 1 ELSE 0 END), 0) AS draft,
         COALESCE(SUM(CASE WHEN j.status = 'posted' THEN 1 ELSE 0 END), 0) AS posted,
         COALESCE(SUM(CASE WHEN j.status = 'posted' THEN j.total_debit ELSE 0 END), 0) AS postedValue
       FROM journal_entries j WHERE j.company_id = ?`,
      [companyId]
    ),
  ]);

  const inv = invoiceSummary[0] || {};
  const age = aging[0] || {};
  const j = journal[0] || {};
  const billed = Number(inv.billed || 0);
  const operatingCost = Number(cost[0]?.cost || 0);

  res.json({
    success: true,
    data: {
      billed,
      collected: Number(inv.collected || 0),
      outstanding: Number(inv.outstanding || 0),
      overdue: Number(inv.overdue || 0),
      cost: operatingCost,
      net: billed - operatingCost,
      agingRows: [
        { key: "current", label: "Current", value: Math.round(Number(age.current || 0)) },
        { key: "d30", label: "1–30 days", value: Math.round(Number(age.d30 || 0)) },
        { key: "d60", label: "31–60 days", value: Math.round(Number(age.d60 || 0)) },
        { key: "d90", label: "60+ days", value: Math.round(Number(age.d90 || 0)) },
      ],
      invoiceStatusRows: rows(invoiceStatus, titleCase),
      costCategoryRows: money(costByCategory),
      revenueByMonth: money(revenueByMonth, (k) => k),
      costByMonth: money(costByMonth, (k) => k),
      journal: {
        draft: Number(j.draft || 0),
        posted: Number(j.posted || 0),
        postedValue: Number(j.postedValue || 0),
      },
    },
  });
}
