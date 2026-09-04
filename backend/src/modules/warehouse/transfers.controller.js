import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";

const NUM = (v) => (v === "" || v == null ? null : Number(v));
const STR = (v) => (v === "" || v == null ? null : String(v).trim());
const S_LABEL = { draft: "Draft", approved: "Approved", in_transit: "In Transit", completed: "Completed", cancelled: "Cancelled" };
const I_LABEL = { pending: "Pending", confirmed: "Confirmed", discrepancy: "Discrepancy" };

async function loadTransfer(companyId, id) {
  const [[t]] = await db.execute(
    `SELECT bt.*, sb.branch_name AS source_name, db.branch_name AS dest_name,
            ru.first_name AS req_first, ru.last_name AS req_last,
            au.first_name AS app_first, au.last_name AS app_last
     FROM branch_transfers bt
     JOIN branches sb ON sb.branch_id = bt.source_branch_id
     JOIN branches db ON db.branch_id = bt.dest_branch_id
     LEFT JOIN users ru ON ru.user_id = bt.requested_by
     LEFT JOIN users au ON au.user_id = bt.approved_by
     WHERE bt.transfer_id = ? AND bt.company_id = ?`,
    [id, companyId]
  );
  if (!t) return null;
  const [items] = await db.execute(
    `SELECT ti.*, i.sku, i.name FROM branch_transfer_items ti
     JOIN inventory_items i ON i.item_id = ti.item_id WHERE ti.transfer_id = ?`,
    [id]
  );
  return {
    id: t.transfer_id,
    transferNo: t.transfer_no,
    sourceBranchId: t.source_branch_id,
    sourceBranchName: t.source_name,
    destBranchId: t.dest_branch_id,
    destBranchName: t.dest_name,
    status: S_LABEL[t.status] || t.status,
    rawStatus: t.status,
    notes: t.notes,
    requestedBy: [t.req_first, t.req_last].filter(Boolean).join(" ") || "—",
    approvedBy: [t.app_first, t.app_last].filter(Boolean).join(" ") || null,
    sourceConfirmed: ["in_transit", "completed"].includes(t.status),
    destConfirmed: t.status === "completed",
    dispatchedAt: t.dispatched_at,
    receivedAt: t.received_at,
    createdAt: t.created_at,
    items: items.map((it) => ({
      id: it.id,
      itemId: it.sku,
      itemDbId: it.item_id,
      name: it.name,
      expectedQty: Number(it.expected_qty),
      receivedQty: it.received_qty == null ? null : Number(it.received_qty),
      status: I_LABEL[it.status] || it.status,
    })),
  };
}

export async function listTransfers(req, res) {
  const { companyId } = req.context;
  const [rows] = await db.execute(
    "SELECT transfer_id FROM branch_transfers WHERE company_id = ? ORDER BY created_at DESC, transfer_id DESC",
    [companyId]
  );
  const data = [];
  for (const r of rows) data.push(await loadTransfer(companyId, r.transfer_id));
  res.json({ success: true, data });
}

export async function getTransfer(req, res) {
  const t = await loadTransfer(req.context.companyId, Number(req.params.id));
  if (!t) return res.status(404).json({ success: false, message: "Transfer not found." });
  res.json({ success: true, data: t });
}

export async function transferStats(req, res) {
  const { companyId } = req.context;
  const [rows] = await db.execute(
    "SELECT status, COUNT(*) n FROM branch_transfers WHERE company_id = ? GROUP BY status",
    [companyId]
  );
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  const [[disc]] = await db.execute(
    `SELECT COUNT(DISTINCT ti.transfer_id) n FROM branch_transfer_items ti
     JOIN branch_transfers bt ON bt.transfer_id = ti.transfer_id
     WHERE bt.company_id = ? AND ti.status = 'discrepancy'`,
    [companyId]
  );
  res.json({
    success: true,
    data: {
      total: rows.reduce((a, r) => a + Number(r.n), 0),
      pending: (by.draft || 0) + (by.approved || 0),
      inTransit: by.in_transit || 0,
      completed: by.completed || 0,
      discrepancies: Number(disc.n),
    },
  });
}

export async function createTransfer(req, res) {
  const { companyId, userId } = req.context;
  const b = req.body;
  const src = NUM(b.sourceBranchId);
  const dest = NUM(b.destBranchId);
  const items = Array.isArray(b.items) ? b.items : [];

  if (!src || !dest || src === dest) {
    return res.status(400).json({ success: false, message: "Pick a different source and destination branch." });
  }
  const cleanItems = items
    .map((i) => ({ sku: STR(i.itemId), qty: NUM(i.expectedQty) }))
    .filter((i) => i.sku && i.qty > 0);
  if (!cleanItems.length) {
    return res.status(400).json({ success: false, message: "Add at least one item with a quantity." });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const bId of [src, dest]) {
      const [[br]] = await conn.execute("SELECT branch_id FROM branches WHERE branch_id = ? AND company_id = ?", [bId, companyId]);
      if (!br) { await conn.rollback(); return res.status(400).json({ success: false, message: "Invalid branch." }); }
    }

    const [[{ next }]] = await conn.execute(
      "SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(transfer_no, '-', -1) AS UNSIGNED)), 0) + 1 AS next FROM branch_transfers WHERE company_id = ? AND transfer_no LIKE ?",
      [companyId, `BT-${new Date().getFullYear()}-%`]
    );
    const ref = `BT-${new Date().getFullYear()}-${String(next).padStart(3, "0")}`;

    const [ins] = await conn.execute(
      "INSERT INTO branch_transfers (company_id, transfer_no, source_branch_id, dest_branch_id, status, notes, requested_by) VALUES (?, ?, ?, ?, 'draft', ?, ?)",
      [companyId, ref, src, dest, STR(b.notes), userId]
    );

    for (const it of cleanItems) {
      const [[item]] = await conn.execute(
        "SELECT item_id FROM inventory_items WHERE company_id = ? AND sku = ? AND status = 'active'",
        [companyId, it.sku]
      );
      if (!item) { await conn.rollback(); return res.status(400).json({ success: false, message: `Unknown item ${it.sku}.` }); }
      await conn.execute(
        "INSERT INTO branch_transfer_items (transfer_id, item_id, expected_qty) VALUES (?, ?, ?)",
        [ins.insertId, item.item_id, it.qty]
      );
    }

    await conn.commit();
    await recordAudit(req, { module: "warehouse", action: "transfer.create", entityType: "branch_transfer", entityId: ins.insertId, summary: `Created transfer ${ref}` });
    res.status(201).json({ success: true, message: "Transfer created.", data: { transferId: ins.insertId, transferNo: ref } });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function approveTransfer(req, res) {
  const { companyId, userId } = req.context;
  const id = Number(req.params.id);
  const [[t]] = await db.execute("SELECT status FROM branch_transfers WHERE transfer_id = ? AND company_id = ?", [id, companyId]);
  if (!t) return res.status(404).json({ success: false, message: "Transfer not found." });
  if (t.status !== "draft") return res.status(409).json({ success: false, message: "Only a draft transfer can be approved." });
  await db.execute("UPDATE branch_transfers SET status = 'approved', approved_by = ? WHERE transfer_id = ?", [userId, id]);
  await recordAudit(req, { module: "warehouse", action: "transfer.approve", entityType: "branch_transfer", entityId: id, summary: `Approved transfer #${id}` });
  res.json({ success: true, message: "Transfer approved." });
}

/** source branch dispatches — deduct source stock, mark in_transit */
export async function dispatchTransfer(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.execute(
      "SELECT source_branch_id, status FROM branch_transfers WHERE transfer_id = ? AND company_id = ? FOR UPDATE",
      [id, companyId]
    );
    if (!t) { await conn.rollback(); return res.status(404).json({ success: false, message: "Transfer not found." }); }
    if (t.status !== "approved") { await conn.rollback(); return res.status(409).json({ success: false, message: "Transfer must be approved before dispatch." }); }

    const [items] = await conn.execute("SELECT item_id, expected_qty FROM branch_transfer_items WHERE transfer_id = ?", [id]);
    for (const it of items) {
      const [[stock]] = await conn.execute(
        "SELECT stock_id, quantity FROM inventory_stock WHERE company_id = ? AND item_id = ? AND location_type = 'branch' AND location_id = ? FOR UPDATE",
        [companyId, it.item_id, t.source_branch_id]
      );
      if (!stock || stock.quantity < it.expected_qty) {
        await conn.rollback();
        return res.status(409).json({ success: false, message: `Source branch is short on stock for item #${it.item_id} (${stock?.quantity ?? 0} available, ${it.expected_qty} needed).` });
      }
      await conn.execute("UPDATE inventory_stock SET quantity = quantity - ? WHERE stock_id = ?", [it.expected_qty, stock.stock_id]);
    }
    await conn.execute("UPDATE branch_transfers SET status = 'in_transit', dispatched_at = NOW() WHERE transfer_id = ?", [id]);
    await conn.commit();
    await recordAudit(req, { module: "warehouse", action: "transfer.dispatch", entityType: "branch_transfer", entityId: id, summary: `Dispatched transfer #${id}` });
    res.json({ success: true, message: "Transfer dispatched — stock deducted from the source branch." });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** destination receives — record received qty per item, add dest stock, complete */
export async function receiveTransfer(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const received = req.body.received || {}; // { transferItemId: qty }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.execute(
      "SELECT dest_branch_id, status FROM branch_transfers WHERE transfer_id = ? AND company_id = ? FOR UPDATE",
      [id, companyId]
    );
    if (!t) { await conn.rollback(); return res.status(404).json({ success: false, message: "Transfer not found." }); }
    if (t.status !== "in_transit") { await conn.rollback(); return res.status(409).json({ success: false, message: "Only an in-transit transfer can be received." }); }

    const [items] = await conn.execute("SELECT id, item_id, expected_qty FROM branch_transfer_items WHERE transfer_id = ?", [id]);
    for (const it of items) {
      const qty = Math.max(0, Number(received[it.id] ?? it.expected_qty));
      const status = qty === it.expected_qty ? "confirmed" : "discrepancy";
      await conn.execute("UPDATE branch_transfer_items SET received_qty = ?, status = ? WHERE id = ?", [qty, status, it.id]);

      if (qty > 0) {
        const [[stock]] = await conn.execute(
          "SELECT stock_id FROM inventory_stock WHERE company_id = ? AND item_id = ? AND location_type = 'branch' AND location_id = ? FOR UPDATE",
          [companyId, it.item_id, t.dest_branch_id]
        );
        if (stock) {
          await conn.execute("UPDATE inventory_stock SET quantity = quantity + ? WHERE stock_id = ?", [qty, stock.stock_id]);
        } else {
          await conn.execute(
            "INSERT INTO inventory_stock (company_id, item_id, location_type, location_id, quantity) VALUES (?, ?, 'branch', ?, ?)",
            [companyId, it.item_id, t.dest_branch_id, qty]
          );
        }
      }
    }
    await conn.execute("UPDATE branch_transfers SET status = 'completed', received_at = NOW() WHERE transfer_id = ?", [id]);
    await conn.commit();
    await recordAudit(req, { module: "warehouse", action: "transfer.receive", entityType: "branch_transfer", entityId: id, summary: `Received transfer #${id}` });
    res.json({ success: true, message: "Transfer received — stock added to the destination branch." });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function cancelTransfer(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [[t]] = await db.execute("SELECT status FROM branch_transfers WHERE transfer_id = ? AND company_id = ?", [id, companyId]);
  if (!t) return res.status(404).json({ success: false, message: "Transfer not found." });
  if (!["draft", "approved"].includes(t.status)) {
    return res.status(409).json({ success: false, message: "Only a draft or approved transfer can be cancelled." });
  }
  await db.execute("UPDATE branch_transfers SET status = 'cancelled' WHERE transfer_id = ?", [id]);
  await recordAudit(req, { module: "warehouse", action: "transfer.cancel", entityType: "branch_transfer", entityId: id, summary: `Cancelled transfer #${id}` });
  res.json({ success: true, message: "Transfer cancelled." });
}
