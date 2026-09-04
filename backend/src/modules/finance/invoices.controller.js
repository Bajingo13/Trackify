import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { STR, NUM, money, nextDocNo, ok, fail, pageParams, runList } from "./_shared.js";

async function loadInvoice(companyId, id, runner = db) {
  const [[i]] = await runner.execute(
    `SELECT inv.*, c.customer_name, c.customer_code
       FROM invoices inv
       JOIN customers c ON c.customer_id = inv.customer_id
      WHERE inv.invoice_id = ? AND inv.company_id = ? LIMIT 1`,
    [id, companyId]
  );
  if (!i) return null;
  const [lines] = await runner.execute(
    "SELECT line_id, description, trip_ticket_id, quantity, unit_price, amount FROM invoice_lines WHERE invoice_id = ? ORDER BY line_id",
    [id]
  );
  return {
    id: i.invoice_id,
    invoiceNo: i.invoice_no,
    customerId: i.customer_id,
    customerName: i.customer_name,
    customerCode: i.customer_code,
    invoiceDate: i.invoice_date,
    dueDate: i.due_date,
    subtotal: Number(i.subtotal),
    taxAmount: Number(i.tax_amount),
    total: Number(i.total),
    amountPaid: Number(i.amount_paid),
    balance: Number(i.total) - Number(i.amount_paid),
    status: i.status,
    notes: i.notes,
    createdAt: i.created_at,
    lines: lines.map((l) => ({
      id: l.line_id, description: l.description, tripTicketId: l.trip_ticket_id,
      quantity: Number(l.quantity), unitPrice: Number(l.unit_price), amount: Number(l.amount),
    })),
  };
}

function normalizeLines(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((l) => {
      const quantity = NUM(l.quantity) || 1;
      const unitPrice = money(l.unitPrice);
      return { description: STR(l.description), tripTicketId: l.tripTicketId ? Number(l.tripTicketId) : null, quantity, unitPrice, amount: money(quantity * unitPrice) };
    })
    .filter((l) => l.description && l.amount > 0);
}

export async function listInvoices(req, res) {
  const { companyId } = req.context;
  const { status, customerId, search, from, to } = req.query;
  const where = ["inv.company_id = ?"];
  const params = [companyId];
  if (status) { where.push("inv.status = ?"); params.push(status); }
  if (customerId) { where.push("inv.customer_id = ?"); params.push(Number(customerId)); }
  if (from) { where.push("inv.invoice_date >= ?"); params.push(from); }
  if (to) { where.push("inv.invoice_date <= ?"); params.push(to); }
  if (search) { where.push("(inv.invoice_no LIKE ? OR c.customer_name LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
  const { limit, offset, page } = pageParams(req.query);
  const { rows, total } = await runList(db, {
    selectSql: `SELECT inv.invoice_id id, inv.invoice_no invoiceNo, inv.customer_id customerId, c.customer_name customerName,
            inv.invoice_date invoiceDate, inv.due_date dueDate, inv.total, inv.amount_paid amountPaid, inv.status`,
    fromWhereSql: `FROM invoices inv JOIN customers c ON c.customer_id = inv.customer_id
      WHERE ${where.join(" AND ")}`,
    orderSql: "ORDER BY inv.invoice_date DESC, inv.invoice_id DESC",
    params, limit, offset,
  });
  ok(res, rows.map((r) => ({ ...r, total: Number(r.total), amountPaid: Number(r.amountPaid), balance: Number(r.total) - Number(r.amountPaid) })),
    limit == null ? {} : { pagination: { total, page, limit } });
}

export async function getInvoice(req, res) {
  const inv = await loadInvoice(req.context.companyId, Number(req.params.id));
  if (!inv) return fail(res, 404, "Invoice not found.");
  ok(res, inv);
}

export async function invoiceStats(req, res) {
  const { companyId } = req.context;
  const [[s]] = await db.execute(
    `SELECT
        COUNT(*) total,
        COALESCE(SUM(CASE WHEN status NOT IN ('paid','void') THEN total - amount_paid ELSE 0 END), 0) outstanding,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END), 0) collected,
        COALESCE(SUM(CASE WHEN status NOT IN ('paid','void') AND due_date < CURDATE() THEN total - amount_paid ELSE 0 END), 0) overdue
       FROM invoices WHERE company_id = ?`,
    [companyId]
  );
  ok(res, { total: Number(s.total), outstanding: Number(s.outstanding), collected: Number(s.collected), overdue: Number(s.overdue) });
}

export async function createInvoice(req, res) {
  const { companyId, branchId, userId } = req.context;
  const b = req.body;
  const customerId = Number(b.customerId);
  if (!customerId) return fail(res, 400, "Customer is required.");
  const [[cust]] = await db.execute("SELECT customer_id FROM customers WHERE customer_id = ? AND company_id = ? LIMIT 1", [customerId, companyId]);
  if (!cust) return fail(res, 400, "That customer does not exist.");
  const lines = normalizeLines(b.lines);
  if (!lines.length) return fail(res, 400, "Add at least one line item.");
  const subtotal = money(lines.reduce((s, l) => s + l.amount, 0));
  const taxAmount = b.taxAmount !== undefined ? money(b.taxAmount) : money(subtotal * (NUM(b.taxRate) / 100));
  const total = money(subtotal + taxAmount);
  const invoiceDate = STR(b.invoiceDate) || new Date().toISOString().slice(0, 10);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const invoiceNo = await nextDocNo(conn, { table: "invoices", col: "invoice_no", prefix: "INV", companyId });
    const [r] = await conn.execute(
      `INSERT INTO invoices (company_id, branch_id, invoice_no, customer_id, invoice_date, due_date, subtotal, tax_amount, total, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, branchId, invoiceNo, customerId, invoiceDate, STR(b.dueDate), subtotal, taxAmount, total, STR(b.notes), userId]
    );
    for (const l of lines) {
      await conn.execute(
        "INSERT INTO invoice_lines (invoice_id, description, trip_ticket_id, quantity, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?)",
        [r.insertId, l.description, l.tripTicketId, l.quantity, l.unitPrice, l.amount]
      );
    }
    await conn.commit();
    await recordAudit(req, { module: "finance", action: "invoice.create", entityType: "invoice", entityId: r.insertId, summary: `Created ${invoiceNo} — ₱${total}` });
    res.status(201).json({ success: true, message: "Invoice created.", data: { id: r.insertId, invoiceNo } });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function updateInvoice(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const b = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[inv]] = await conn.execute("SELECT * FROM invoices WHERE invoice_id = ? AND company_id = ? FOR UPDATE", [id, companyId]);
    if (!inv) { await conn.rollback(); return fail(res, 404, "Invoice not found."); }
    if (inv.status !== "draft") { await conn.rollback(); return fail(res, 409, "Only draft invoices can be edited."); }

    let { subtotal, tax_amount: taxAmount, total } = inv;
    if (b.lines !== undefined) {
      const lines = normalizeLines(b.lines);
      if (!lines.length) { await conn.rollback(); return fail(res, 400, "Add at least one line item."); }
      subtotal = money(lines.reduce((s, l) => s + l.amount, 0));
      taxAmount = b.taxAmount !== undefined ? money(b.taxAmount) : money(subtotal * (NUM(b.taxRate) / 100));
      total = money(Number(subtotal) + Number(taxAmount));
      await conn.execute("DELETE FROM invoice_lines WHERE invoice_id = ?", [id]);
      for (const l of lines) {
        await conn.execute(
          "INSERT INTO invoice_lines (invoice_id, description, trip_ticket_id, quantity, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?)",
          [id, l.description, l.tripTicketId, l.quantity, l.unitPrice, l.amount]
        );
      }
    } else if (b.taxAmount !== undefined) {
      taxAmount = money(b.taxAmount);
      total = money(Number(subtotal) + Number(taxAmount));
    }

    await conn.execute(
      "UPDATE invoices SET customer_id = ?, invoice_date = ?, due_date = ?, notes = ?, subtotal = ?, tax_amount = ?, total = ? WHERE invoice_id = ?",
      [
        b.customerId ? Number(b.customerId) : inv.customer_id,
        STR(b.invoiceDate) || inv.invoice_date,
        b.dueDate !== undefined ? STR(b.dueDate) : inv.due_date,
        b.notes !== undefined ? STR(b.notes) : inv.notes,
        subtotal, taxAmount, total, id,
      ]
    );
    await conn.commit();
    await recordAudit(req, { module: "finance", action: "invoice.update", entityType: "invoice", entityId: id, summary: `Updated ${inv.invoice_no}`, metadata: b });
    ok(res, await loadInvoice(companyId, id));
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function sendInvoice(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [[inv]] = await db.execute("SELECT status, invoice_no FROM invoices WHERE invoice_id = ? AND company_id = ? LIMIT 1", [id, companyId]);
  if (!inv) return fail(res, 404, "Invoice not found.");
  if (inv.status !== "draft") return fail(res, 409, `Invoice is already ${inv.status}.`);
  await db.execute("UPDATE invoices SET status = 'sent' WHERE invoice_id = ?", [id]);
  await recordAudit(req, { module: "finance", action: "invoice.send", entityType: "invoice", entityId: id, summary: `Sent ${inv.invoice_no}` });
  ok(res, await loadInvoice(companyId, id));
}

export async function recordPayment(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const amount = money(req.body.amount);
  if (amount <= 0) return fail(res, 400, "Payment amount must be greater than zero.");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[inv]] = await conn.execute("SELECT * FROM invoices WHERE invoice_id = ? AND company_id = ? FOR UPDATE", [id, companyId]);
    if (!inv) { await conn.rollback(); return fail(res, 404, "Invoice not found."); }
    if (!["sent", "partial"].includes(inv.status)) { await conn.rollback(); return fail(res, 409, `Can't record a payment on a ${inv.status} invoice.`); }
    const newPaid = money(Number(inv.amount_paid) + amount);
    if (newPaid > Number(inv.total) + 0.01) { await conn.rollback(); return fail(res, 400, `Payment exceeds the outstanding balance of ₱${(Number(inv.total) - Number(inv.amount_paid)).toFixed(2)}.`); }
    const status = newPaid >= Number(inv.total) - 0.01 ? "paid" : "partial";
    await conn.execute("UPDATE invoices SET amount_paid = ?, status = ? WHERE invoice_id = ?", [newPaid, status, id]);
    await conn.commit();
    await recordAudit(req, { module: "finance", action: "invoice.payment", entityType: "invoice", entityId: id, summary: `Payment ₱${amount} on ${inv.invoice_no}` });
    ok(res, await loadInvoice(companyId, id));
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function voidInvoice(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [[inv]] = await db.execute("SELECT status, invoice_no FROM invoices WHERE invoice_id = ? AND company_id = ? LIMIT 1", [id, companyId]);
  if (!inv) return fail(res, 404, "Invoice not found.");
  if (inv.status === "paid") return fail(res, 409, "A fully paid invoice can't be voided.");
  if (inv.status === "void") return fail(res, 409, "Invoice is already void.");
  await db.execute("UPDATE invoices SET status = 'void' WHERE invoice_id = ?", [id]);
  await recordAudit(req, { module: "finance", action: "invoice.void", entityType: "invoice", entityId: id, summary: `Voided ${inv.invoice_no}` });
  ok(res, await loadInvoice(companyId, id));
}
