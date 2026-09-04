import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { STR, money, nextDocNo, ok, fail, pageParams, runList } from "./_shared.js";

async function loadEntry(companyId, id, runner = db) {
  const [[e]] = await runner.execute(
    "SELECT * FROM journal_entries WHERE entry_id = ? AND company_id = ? LIMIT 1",
    [id, companyId]
  );
  if (!e) return null;
  const [lines] = await runner.execute(
    `SELECT jl.line_id, jl.account_id, jl.description, jl.debit, jl.credit,
            a.account_code, a.account_name
       FROM journal_lines jl JOIN chart_of_accounts a ON a.account_id = jl.account_id
      WHERE jl.entry_id = ? ORDER BY jl.line_id`,
    [id]
  );
  return {
    id: e.entry_id,
    entryNo: e.entry_no,
    entryDate: e.entry_date,
    memo: e.memo,
    reference: e.reference,
    status: e.status,
    totalDebit: Number(e.total_debit),
    totalCredit: Number(e.total_credit),
    postedAt: e.posted_at,
    createdAt: e.created_at,
    lines: lines.map((l) => ({
      id: l.line_id, accountId: l.account_id, accountCode: l.account_code, accountName: l.account_name,
      description: l.description, debit: Number(l.debit), credit: Number(l.credit),
    })),
  };
}

async function normalizeLines(companyId, raw, runner = db) {
  const lines = (Array.isArray(raw) ? raw : [])
    .map((l) => ({ accountId: Number(l.accountId), description: STR(l.description), debit: money(l.debit), credit: money(l.credit) }))
    .filter((l) => l.accountId && (l.debit > 0 || l.credit > 0));
  if (lines.length < 2) return { error: "A journal entry needs at least two lines." };
  for (const l of lines) {
    if (l.debit > 0 && l.credit > 0) return { error: "Each line is either a debit or a credit, not both." };
  }
  const ids = [...new Set(lines.map((l) => l.accountId))];
  const [accs] = await runner.execute(
    `SELECT account_id FROM chart_of_accounts WHERE company_id = ? AND account_id IN (${ids.map(() => "?").join(",")})`,
    [companyId, ...ids]
  );
  if (accs.length !== ids.length) return { error: "One or more accounts don't exist." };
  const totalDebit = money(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = money(lines.reduce((s, l) => s + l.credit, 0));
  return { lines, totalDebit, totalCredit };
}

export async function listEntries(req, res) {
  const { companyId } = req.context;
  const { status, search, from, to } = req.query;
  const where = ["company_id = ?"];
  const params = [companyId];
  if (status) { where.push("status = ?"); params.push(status); }
  if (from) { where.push("entry_date >= ?"); params.push(from); }
  if (to) { where.push("entry_date <= ?"); params.push(to); }
  if (search) { where.push("(entry_no LIKE ? OR memo LIKE ? OR reference LIKE ?)"); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const { limit, offset, page } = pageParams(req.query);
  const { rows, total } = await runList(db, {
    selectSql: `SELECT entry_id id, entry_no entryNo, entry_date entryDate, memo, reference, status,
            total_debit totalDebit, total_credit totalCredit, posted_at postedAt, created_at createdAt`,
    fromWhereSql: `FROM journal_entries WHERE ${where.join(" AND ")}`,
    orderSql: "ORDER BY entry_date DESC, entry_id DESC",
    params, limit, offset,
  });
  ok(res, rows.map((r) => ({ ...r, totalDebit: Number(r.totalDebit), totalCredit: Number(r.totalCredit) })),
    limit == null ? {} : { pagination: { total, page, limit } });
}

export async function getEntry(req, res) {
  const e = await loadEntry(req.context.companyId, Number(req.params.id));
  if (!e) return fail(res, 404, "Journal entry not found.");
  ok(res, e);
}

export async function entryStats(req, res) {
  const { companyId } = req.context;
  const [[s]] = await db.execute(
    `SELECT
        COUNT(*) total,
        COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) draft,
        COALESCE(SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END), 0) posted,
        COALESCE(SUM(CASE WHEN status = 'posted' THEN total_debit ELSE 0 END), 0) postedValue
       FROM journal_entries WHERE company_id = ?`,
    [companyId]
  );
  ok(res, { total: Number(s.total), draft: Number(s.draft), posted: Number(s.posted), postedValue: Number(s.postedValue) });
}

export async function createEntry(req, res) {
  const { companyId, branchId, userId } = req.context;
  const b = req.body;
  const norm = await normalizeLines(companyId, b.lines);
  if (norm.error) return fail(res, 400, norm.error);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const entryNo = await nextDocNo(conn, { table: "journal_entries", col: "entry_no", prefix: "JE", companyId });
    const [r] = await conn.execute(
      `INSERT INTO journal_entries (company_id, branch_id, entry_no, entry_date, memo, reference, total_debit, total_credit, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, branchId, entryNo, STR(b.entryDate) || new Date().toISOString().slice(0, 10), STR(b.memo), STR(b.reference), norm.totalDebit, norm.totalCredit, userId]
    );
    for (const l of norm.lines) {
      await conn.execute(
        "INSERT INTO journal_lines (entry_id, account_id, description, debit, credit) VALUES (?, ?, ?, ?, ?)",
        [r.insertId, l.accountId, l.description, l.debit, l.credit]
      );
    }
    await conn.commit();
    await recordAudit(req, { module: "finance", action: "journal.create", entityType: "journal_entry", entityId: r.insertId, summary: `Created ${entryNo}` });
    res.status(201).json({ success: true, message: "Journal entry created.", data: { id: r.insertId, entryNo } });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function updateEntry(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const b = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[e]] = await conn.execute("SELECT * FROM journal_entries WHERE entry_id = ? AND company_id = ? FOR UPDATE", [id, companyId]);
    if (!e) { await conn.rollback(); return fail(res, 404, "Journal entry not found."); }
    if (e.status !== "draft") { await conn.rollback(); return fail(res, 409, "Only draft entries can be edited."); }

    let totalDebit = e.total_debit;
    let totalCredit = e.total_credit;
    if (b.lines !== undefined) {
      const norm = await normalizeLines(companyId, b.lines, conn);
      if (norm.error) { await conn.rollback(); return fail(res, 400, norm.error); }
      totalDebit = norm.totalDebit;
      totalCredit = norm.totalCredit;
      await conn.execute("DELETE FROM journal_lines WHERE entry_id = ?", [id]);
      for (const l of norm.lines) {
        await conn.execute(
          "INSERT INTO journal_lines (entry_id, account_id, description, debit, credit) VALUES (?, ?, ?, ?, ?)",
          [id, l.accountId, l.description, l.debit, l.credit]
        );
      }
    }
    await conn.execute(
      "UPDATE journal_entries SET entry_date = ?, memo = ?, reference = ?, total_debit = ?, total_credit = ? WHERE entry_id = ?",
      [STR(b.entryDate) || e.entry_date, b.memo !== undefined ? STR(b.memo) : e.memo, b.reference !== undefined ? STR(b.reference) : e.reference, totalDebit, totalCredit, id]
    );
    await conn.commit();
    await recordAudit(req, { module: "finance", action: "journal.update", entityType: "journal_entry", entityId: id, summary: `Updated ${e.entry_no}`, metadata: b });
    ok(res, await loadEntry(companyId, id));
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function postEntry(req, res) {
  const { companyId, userId } = req.context;
  const id = Number(req.params.id);
  const [[e]] = await db.execute("SELECT * FROM journal_entries WHERE entry_id = ? AND company_id = ? LIMIT 1", [id, companyId]);
  if (!e) return fail(res, 404, "Journal entry not found.");
  if (e.status !== "draft") return fail(res, 409, `Entry is already ${e.status}.`);
  if (Number(e.total_debit) <= 0) return fail(res, 409, "Entry has no amounts.");
  if (Math.abs(Number(e.total_debit) - Number(e.total_credit)) > 0.01) {
    return fail(res, 409, `Entry is out of balance: debits ₱${Number(e.total_debit).toFixed(2)} vs credits ₱${Number(e.total_credit).toFixed(2)}.`);
  }
  await db.execute("UPDATE journal_entries SET status = 'posted', posted_by = ?, posted_at = NOW() WHERE entry_id = ?", [userId, id]);
  await recordAudit(req, { module: "finance", action: "journal.post", entityType: "journal_entry", entityId: id, summary: `Posted ${e.entry_no}` });
  ok(res, await loadEntry(companyId, id));
}

export async function voidEntry(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [[e]] = await db.execute("SELECT status, entry_no FROM journal_entries WHERE entry_id = ? AND company_id = ? LIMIT 1", [id, companyId]);
  if (!e) return fail(res, 404, "Journal entry not found.");
  if (e.status === "void") return fail(res, 409, "Entry is already void.");
  await db.execute("UPDATE journal_entries SET status = 'void' WHERE entry_id = ?", [id]);
  await recordAudit(req, { module: "finance", action: "journal.void", entityType: "journal_entry", entityId: id, summary: `Voided ${e.entry_no}` });
  ok(res, await loadEntry(companyId, id));
}

export async function deleteEntry(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [[e]] = await db.execute("SELECT status, entry_no FROM journal_entries WHERE entry_id = ? AND company_id = ? LIMIT 1", [id, companyId]);
  if (!e) return fail(res, 404, "Journal entry not found.");
  if (e.status !== "draft") return fail(res, 409, "Only draft entries can be deleted.");
  await db.execute("DELETE FROM journal_entries WHERE entry_id = ?", [id]);
  await recordAudit(req, { module: "finance", action: "journal.delete", entityType: "journal_entry", entityId: id, summary: `Deleted ${e.entry_no}` });
  ok(res, { id });
}
