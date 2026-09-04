import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { STR, money, nextDocNo, ok, fail, pageParams, runList } from "./_shared.js";

async function loadVoucher(companyId, id, runner = db) {
  const [[v]] = await runner.execute(
    `SELECT ev.*,
            CONCAT_WS(' ', su.first_name, su.last_name) AS submitted_by_name,
            CONCAT_WS(' ', au.first_name, au.last_name) AS approved_by_name
       FROM expense_vouchers ev
       LEFT JOIN users su ON su.user_id = ev.submitted_by
       LEFT JOIN users au ON au.user_id = ev.approved_by
      WHERE ev.voucher_id = ? AND ev.company_id = ? LIMIT 1`,
    [id, companyId]
  );
  if (!v) return null;
  const [lines] = await runner.execute(
    "SELECT line_id, description, amount, trip_expense_id FROM expense_voucher_lines WHERE voucher_id = ? ORDER BY line_id",
    [id]
  );
  return {
    id: v.voucher_id,
    voucherNo: v.voucher_no,
    payee: v.payee,
    purpose: v.purpose,
    totalAmount: Number(v.total_amount),
    status: v.status,
    notes: v.notes,
    submittedBy: v.submitted_by_name,
    submittedAt: v.submitted_at,
    approvedBy: v.approved_by_name,
    approvedAt: v.approved_at,
    paidAt: v.paid_at,
    createdAt: v.created_at,
    lines: lines.map((l) => ({ id: l.line_id, description: l.description, amount: Number(l.amount), tripExpenseId: l.trip_expense_id })),
  };
}

export async function listVouchers(req, res) {
  const { companyId } = req.context;
  const { status, search } = req.query;
  const where = ["company_id = ?"];
  const params = [companyId];
  if (status) { where.push("status = ?"); params.push(status); }
  if (search) { where.push("(voucher_no LIKE ? OR payee LIKE ? OR purpose LIKE ?)"); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const { limit, offset, page } = pageParams(req.query);
  const { rows, total } = await runList(db, {
    selectSql: `SELECT voucher_id id, voucher_no voucherNo, payee, purpose, total_amount totalAmount, status,
            submitted_at submittedAt, approved_at approvedAt, paid_at paidAt, created_at createdAt`,
    fromWhereSql: `FROM expense_vouchers WHERE ${where.join(" AND ")}`,
    orderSql: "ORDER BY created_at DESC, voucher_id DESC",
    params, limit, offset,
  });
  ok(res, rows.map((r) => ({ ...r, totalAmount: Number(r.totalAmount) })),
    limit == null ? {} : { pagination: { total, page, limit } });
}

export async function getVoucher(req, res) {
  const v = await loadVoucher(req.context.companyId, Number(req.params.id));
  if (!v) return fail(res, 404, "Voucher not found.");
  ok(res, v);
}

export async function voucherStats(req, res) {
  const { companyId } = req.context;
  const [[s]] = await db.execute(
    `SELECT
        COUNT(*) total,
        COALESCE(SUM(CASE WHEN status IN ('draft','submitted') THEN 1 ELSE 0 END), 0) open,
        COALESCE(SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END), 0) awaitingApproval,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN total_amount ELSE 0 END), 0) approvedUnpaid,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN total_amount ELSE 0 END), 0) paid
       FROM expense_vouchers WHERE company_id = ?`,
    [companyId]
  );
  ok(res, { total: Number(s.total), open: Number(s.open), awaitingApproval: Number(s.awaitingApproval), approvedUnpaid: Number(s.approvedUnpaid), paid: Number(s.paid) });
}

export async function createVoucher(req, res) {
  const { companyId, branchId, userId } = req.context;
  const b = req.body;
  const payee = STR(b.payee);
  if (!payee) return fail(res, 400, "Payee is required.");
  const rawLines = Array.isArray(b.lines) ? b.lines : [];
  const lines = rawLines
    .map((l) => ({ description: STR(l.description), amount: money(l.amount), tripExpenseId: l.tripExpenseId ? Number(l.tripExpenseId) : null }))
    .filter((l) => l.description && l.amount > 0);
  if (!lines.length) return fail(res, 400, "Add at least one line item.");
  const total = money(lines.reduce((s, l) => s + l.amount, 0));

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const voucherNo = await nextDocNo(conn, { table: "expense_vouchers", col: "voucher_no", prefix: "EV", companyId });
    const [r] = await conn.execute(
      `INSERT INTO expense_vouchers (company_id, branch_id, voucher_no, payee, purpose, total_amount, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, branchId, voucherNo, payee, STR(b.purpose), total, STR(b.notes), userId]
    );
    const vid = r.insertId;
    for (const l of lines) {
      await conn.execute(
        "INSERT INTO expense_voucher_lines (voucher_id, description, amount, trip_expense_id) VALUES (?, ?, ?, ?)",
        [vid, l.description, l.amount, l.tripExpenseId]
      );
      if (l.tripExpenseId) {
        await conn.execute(
          "UPDATE trip_expenses SET status = 'on_voucher', voucher_id = ? WHERE expense_id = ? AND company_id = ? AND status = 'recorded'",
          [vid, l.tripExpenseId, companyId]
        );
      }
    }
    await conn.commit();
    await recordAudit(req, { module: "finance", action: "voucher.create", entityType: "expense_voucher", entityId: vid, summary: `Created ${voucherNo} for ${payee} — ₱${total}` });
    res.status(201).json({ success: true, message: "Voucher created.", data: { id: vid, voucherNo } });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function updateVoucher(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const b = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[v]] = await conn.execute(
      "SELECT * FROM expense_vouchers WHERE voucher_id = ? AND company_id = ? FOR UPDATE",
      [id, companyId]
    );
    if (!v) { await conn.rollback(); return fail(res, 404, "Voucher not found."); }
    if (v.status !== "draft") { await conn.rollback(); return fail(res, 409, "Only draft vouchers can be edited."); }

    const payee = b.payee !== undefined ? STR(b.payee) : v.payee;
    if (!payee) { await conn.rollback(); return fail(res, 400, "Payee is required."); }

    let total = Number(v.total_amount);
    if (b.lines !== undefined) {
      const lines = (Array.isArray(b.lines) ? b.lines : [])
        .map((l) => ({ description: STR(l.description), amount: money(l.amount), tripExpenseId: l.tripExpenseId ? Number(l.tripExpenseId) : null }))
        .filter((l) => l.description && l.amount > 0);
      if (!lines.length) { await conn.rollback(); return fail(res, 400, "Add at least one line item."); }
      total = money(lines.reduce((s, l) => s + l.amount, 0));

      // release every expense currently attached to this voucher, then re-attach
      await conn.execute(
        "UPDATE trip_expenses SET status = 'recorded', voucher_id = NULL WHERE voucher_id = ? AND status = 'on_voucher'",
        [id]
      );
      await conn.execute("DELETE FROM expense_voucher_lines WHERE voucher_id = ?", [id]);
      for (const l of lines) {
        await conn.execute(
          "INSERT INTO expense_voucher_lines (voucher_id, description, amount, trip_expense_id) VALUES (?, ?, ?, ?)",
          [id, l.description, l.amount, l.tripExpenseId]
        );
        if (l.tripExpenseId) {
          await conn.execute(
            "UPDATE trip_expenses SET status = 'on_voucher', voucher_id = ? WHERE expense_id = ? AND company_id = ? AND status = 'recorded'",
            [id, l.tripExpenseId, companyId]
          );
        }
      }
    }

    await conn.execute(
      "UPDATE expense_vouchers SET payee = ?, purpose = ?, notes = ?, total_amount = ? WHERE voucher_id = ?",
      [payee, b.purpose !== undefined ? STR(b.purpose) : v.purpose, b.notes !== undefined ? STR(b.notes) : v.notes, total, id]
    );
    await conn.commit();
    await recordAudit(req, { module: "finance", action: "voucher.update", entityType: "expense_voucher", entityId: id, summary: `Updated ${v.voucher_no}`, metadata: b });
    ok(res, await loadVoucher(companyId, id));
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function transition(req, res, { to, from, stamp, audit, releaseExpenses, reimburseExpenses }) {
  const { companyId, userId } = req.context;
  const id = Number(req.params.id);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[v]] = await conn.execute(
      "SELECT * FROM expense_vouchers WHERE voucher_id = ? AND company_id = ? FOR UPDATE",
      [id, companyId]
    );
    if (!v) { await conn.rollback(); return fail(res, 404, "Voucher not found."); }
    if (!from.includes(v.status)) { await conn.rollback(); return fail(res, 409, `Can't ${audit} a voucher that is ${v.status}.`); }

    const sets = ["status = ?"];
    const params = [to];
    if (stamp) { sets.push(`${stamp} = NOW()`); }
    if (stamp === "submitted_at") { sets.push("submitted_by = ?"); params.push(userId); }
    if (stamp === "approved_at") { sets.push("approved_by = ?"); params.push(userId); }
    params.push(id);
    await conn.execute(`UPDATE expense_vouchers SET ${sets.join(", ")} WHERE voucher_id = ?`, params);

    if (releaseExpenses) {
      await conn.execute("UPDATE trip_expenses SET status = 'recorded', voucher_id = NULL WHERE voucher_id = ?", [id]);
    }
    if (reimburseExpenses) {
      await conn.execute("UPDATE trip_expenses SET status = 'reimbursed' WHERE voucher_id = ?", [id]);
    }
    await conn.commit();
    await recordAudit(req, { module: "finance", action: `voucher.${audit}`, entityType: "expense_voucher", entityId: id, summary: `${audit} ${v.voucher_no}` });
    ok(res, await loadVoucher(companyId, id));
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export const submitVoucher = (req, res) => transition(req, res, { to: "submitted", from: ["draft"], stamp: "submitted_at", audit: "submit" });
export const approveVoucher = (req, res) => transition(req, res, { to: "approved", from: ["submitted"], stamp: "approved_at", audit: "approve" });
export const rejectVoucher = (req, res) => transition(req, res, { to: "rejected", from: ["submitted"], audit: "reject", releaseExpenses: true });
export const payVoucher = (req, res) => transition(req, res, { to: "paid", from: ["approved"], stamp: "paid_at", audit: "pay", reimburseExpenses: true });

export async function deleteVoucher(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [[v]] = await db.execute("SELECT status, voucher_no FROM expense_vouchers WHERE voucher_id = ? AND company_id = ? LIMIT 1", [id, companyId]);
  if (!v) return fail(res, 404, "Voucher not found.");
  if (!["draft", "rejected"].includes(v.status)) return fail(res, 409, "Only draft or rejected vouchers can be deleted.");
  await db.execute("UPDATE trip_expenses SET status = 'recorded', voucher_id = NULL WHERE voucher_id = ?", [id]);
  await db.execute("DELETE FROM expense_vouchers WHERE voucher_id = ?", [id]); // lines cascade
  await recordAudit(req, { module: "finance", action: "voucher.delete", entityType: "expense_voucher", entityId: id, summary: `Deleted ${v.voucher_no}` });
  ok(res, { id });
}
