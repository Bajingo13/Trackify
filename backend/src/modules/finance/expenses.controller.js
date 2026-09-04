import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { STR, NUM, money, ok, fail, pageParams, runList } from "./_shared.js";

const CATEGORIES = ["fuel", "toll", "parking", "meals", "lodging", "repair", "misc"];

const mapRow = (r) => ({
  id: r.expense_id,
  tripTicketId: r.trip_ticket_id,
  tripNo: r.ticket_no || null,
  category: r.category,
  description: r.description,
  amount: Number(r.amount),
  expenseDate: r.expense_date,
  receiptNo: r.receipt_no,
  status: r.status,
  voucherId: r.voucher_id,
  voucherNo: r.voucher_no || null,
  createdAt: r.created_at,
});

export async function listExpenses(req, res) {
  const { companyId } = req.context;
  const { tripTicketId, category, status, from, to, search } = req.query;
  const where = ["e.company_id = ?"];
  const params = [companyId];
  if (tripTicketId) { where.push("e.trip_ticket_id = ?"); params.push(Number(tripTicketId)); }
  if (category) { where.push("e.category = ?"); params.push(category); }
  if (status) { where.push("e.status = ?"); params.push(status); }
  if (from) { where.push("e.expense_date >= ?"); params.push(from); }
  if (to) { where.push("e.expense_date <= ?"); params.push(to); }
  if (search) {
    where.push("(e.description LIKE ? OR e.receipt_no LIKE ? OR t.ticket_no LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const { limit, offset, page } = pageParams(req.query);
  const { rows, total } = await runList(db, {
    selectSql: "SELECT e.*, t.ticket_no, v.voucher_no",
    fromWhereSql: `FROM trip_expenses e
       LEFT JOIN trip_tickets t ON t.trip_ticket_id = e.trip_ticket_id
       LEFT JOIN expense_vouchers v ON v.voucher_id = e.voucher_id
      WHERE ${where.join(" AND ")}`,
    orderSql: "ORDER BY e.expense_date DESC, e.expense_id DESC",
    params, limit, offset,
  });
  ok(res, rows.map(mapRow), limit == null ? {} : { pagination: { total, page, limit } });
}

export async function expenseStats(req, res) {
  const { companyId } = req.context;
  const [[s]] = await db.execute(
    `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(amount), 0) AS totalAmount,
        COALESCE(SUM(CASE WHEN status = 'recorded' THEN amount ELSE 0 END), 0) AS unvouchered,
        COALESCE(SUM(CASE WHEN status = 'reimbursed' THEN amount ELSE 0 END), 0) AS reimbursed
       FROM trip_expenses WHERE company_id = ?`,
    [companyId]
  );
  const [byCat] = await db.execute(
    `SELECT category, COALESCE(SUM(amount), 0) amount, COUNT(*) count
       FROM trip_expenses WHERE company_id = ? GROUP BY category`,
    [companyId]
  );
  ok(res, {
    total: Number(s.total),
    totalAmount: Number(s.totalAmount),
    unvouchered: Number(s.unvouchered),
    reimbursed: Number(s.reimbursed),
    byCategory: byCat.map((r) => ({ category: r.category, amount: Number(r.amount), count: Number(r.count) })),
  });
}

export async function createExpense(req, res) {
  const { companyId, branchId, userId } = req.context;
  const b = req.body;
  const category = CATEGORIES.includes(b.category) ? b.category : "misc";
  const amount = money(b.amount);
  const expenseDate = STR(b.expenseDate) || new Date().toISOString().slice(0, 10);
  if (amount <= 0) return fail(res, 400, "Amount must be greater than zero.");

  let tripTicketId = b.tripTicketId ? Number(b.tripTicketId) : null;
  if (tripTicketId) {
    const [[t]] = await db.execute(
      "SELECT trip_ticket_id FROM trip_tickets WHERE trip_ticket_id = ? AND company_id = ? LIMIT 1",
      [tripTicketId, companyId]
    );
    if (!t) return fail(res, 400, "That trip does not exist.");
  }

  const [r] = await db.execute(
    `INSERT INTO trip_expenses (company_id, branch_id, trip_ticket_id, category, description, amount, expense_date, receipt_no, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [companyId, branchId, tripTicketId, category, STR(b.description), amount, expenseDate, STR(b.receiptNo), userId]
  );
  await recordAudit(req, { module: "finance", action: "expense.create", entityType: "trip_expense", entityId: r.insertId, summary: `Recorded ${category} expense ₱${amount}` });
  res.status(201).json({ success: true, message: "Expense recorded.", data: { id: r.insertId } });
}

export async function updateExpense(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [[row]] = await db.execute(
    "SELECT * FROM trip_expenses WHERE expense_id = ? AND company_id = ? LIMIT 1",
    [id, companyId]
  );
  if (!row) return fail(res, 404, "Expense not found.");
  if (row.status !== "recorded") return fail(res, 409, "This expense is already attached to a voucher and can't be edited.");

  const b = req.body;
  const sets = [];
  const params = [];
  if (b.category !== undefined && CATEGORIES.includes(b.category)) { sets.push("category = ?"); params.push(b.category); }
  if (b.description !== undefined) { sets.push("description = ?"); params.push(STR(b.description)); }
  if (b.amount !== undefined) { sets.push("amount = ?"); params.push(money(b.amount)); }
  if (b.expenseDate !== undefined) { sets.push("expense_date = ?"); params.push(STR(b.expenseDate)); }
  if (b.receiptNo !== undefined) { sets.push("receipt_no = ?"); params.push(STR(b.receiptNo)); }
  if (b.tripTicketId !== undefined) { sets.push("trip_ticket_id = ?"); params.push(b.tripTicketId ? Number(b.tripTicketId) : null); }
  if (!sets.length) return fail(res, 400, "Nothing to update.");
  params.push(id);
  await db.execute(`UPDATE trip_expenses SET ${sets.join(", ")} WHERE expense_id = ?`, params);
  await recordAudit(req, { module: "finance", action: "expense.update", entityType: "trip_expense", entityId: id, summary: `Updated expense #${id}`, metadata: b });
  ok(res, { id });
}

export async function deleteExpense(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [[row]] = await db.execute(
    "SELECT status FROM trip_expenses WHERE expense_id = ? AND company_id = ? LIMIT 1",
    [id, companyId]
  );
  if (!row) return fail(res, 404, "Expense not found.");
  if (row.status !== "recorded") return fail(res, 409, "Detach this expense from its voucher first.");
  await db.execute("DELETE FROM trip_expenses WHERE expense_id = ?", [id]);
  await recordAudit(req, { module: "finance", action: "expense.delete", entityType: "trip_expense", entityId: id, summary: `Deleted expense #${id}` });
  ok(res, { id });
}
