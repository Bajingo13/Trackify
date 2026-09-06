/**
 * Driver-submitted trip expenses.
 *
 * A driver logs what they spent on the road — fuel, tolls, parking — against
 * a trip they are actually assigned to, optionally with a photo of the
 * receipt. Claims land as `submitted` and stay outside the voucher flow
 * until someone with expense.manage approves them, so nothing a driver types
 * reaches the books unreviewed.
 */
import fs from "node:fs";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { toRelative, toAbsolute, discard } from "../finance/receipts.storage.js";

/** Same list the finance module accepts. */
const CATEGORIES = ["fuel", "toll", "parking", "meals", "lodging", "repair", "misc"];

/** A driver may only file against a trip currently assigned to them. */
async function assignedTrip(tripId, driverId, companyId) {
  const [[row]] = await db.execute(
    `SELECT tt.trip_ticket_id, tt.branch_id, tt.status, tt.ticket_no
       FROM trip_assignments ta
       JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
      WHERE ta.trip_ticket_id = ? AND ta.driver_id = ? AND ta.is_current = TRUE
        AND tt.company_id = ? LIMIT 1`,
    [tripId, driverId, companyId]
  );
  return row || null;
}

const shape = (r) => ({
  id: r.expense_id,
  tripTicketId: r.trip_ticket_id,
  category: r.category,
  description: r.description,
  amount: Number(r.amount),
  expenseDate: r.expense_date,
  receiptNo: r.receipt_no,
  status: r.status,
  reviewNote: r.review_note,
  reviewedAt: r.reviewed_at,
  hasReceipt: Number(r.attachment_count) > 0,
  createdAt: r.created_at,
});

export async function listMyExpenses(req, res) {
  const { driverId, companyId } = req.driver;
  const tripId = Number(req.params.id);

  const trip = await assignedTrip(tripId, driverId, companyId);
  if (!trip) return res.status(404).json({ success: false, message: "Trip not found." });

  const [rows] = await db.execute(
    `SELECT e.*, (SELECT COUNT(*) FROM expense_attachments a WHERE a.expense_id = e.expense_id) AS attachment_count
       FROM trip_expenses e
      WHERE e.trip_ticket_id = ? AND e.submitted_by_driver_id = ?
      ORDER BY e.expense_id DESC`,
    [tripId, driverId]
  );

  res.json({ success: true, data: rows.map(shape) });
}

export async function submitExpense(req, res) {
  const { driverId, companyId } = req.driver;
  const tripId = Number(req.params.id);
  const file = req.file || null;

  const bail = (status, message) => {
    if (file) discard(file.path);
    return res.status(status).json({ success: false, message });
  };

  const trip = await assignedTrip(tripId, driverId, companyId);
  if (!trip) return bail(404, "Trip not found.");
  if (!["released", "in_transit", "delivered"].includes(trip.status)) {
    return bail(409, "You can only log expenses once the trip has been released.");
  }

  const category = CATEGORIES.includes(req.body.category) ? req.body.category : "misc";
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return bail(400, "Enter how much you spent.");
  }
  if (amount > 1_000_000) {
    return bail(400, "That amount looks wrong — check it and try again.");
  }

  const expenseDate =
    String(req.body.expenseDate || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const description = String(req.body.description || "").trim().slice(0, 255) || null;
  const receiptNo = String(req.body.receiptNo || "").trim().slice(0, 100) || null;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [r] = await conn.execute(
      `INSERT INTO trip_expenses
         (company_id, branch_id, trip_ticket_id, category, description, amount,
          expense_date, receipt_no, status, submitted_by_driver_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
      [companyId, trip.branch_id, tripId, category, description, amount, expenseDate, receiptNo, driverId]
    );

    if (file) {
      await conn.execute(
        `INSERT INTO expense_attachments
           (expense_id, company_id, file_name, mime_type, byte_size, storage_path, uploaded_by_driver_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          r.insertId,
          companyId,
          String(file.originalname || "receipt").slice(0, 255),
          file.mimetype,
          file.size,
          toRelative(file.path),
          driverId,
        ]
      );
    }

    await conn.commit();

    // driver routes sit outside the staff context chain, so scope the audit
    // row explicitly rather than letting it record against no company
    req.context = req.context || { companyId, branchId: trip.branch_id };
    await recordAudit(req, {
      module: "driver-app",
      action: "expense.submit",
      entityType: "trip_expense",
      entityId: r.insertId,
      summary: `Driver submitted ${category} expense ₱${amount} on ${trip.ticket_no}${file ? " with receipt" : ""}`,
    });

    res.status(201).json({
      success: true,
      message: "Sent for review.",
      data: { id: r.insertId, hasReceipt: !!file },
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (file) discard(file.path);
    throw err;
  } finally {
    conn.release();
  }
}

/** The driver may look at the receipt they themselves uploaded. */
export async function myReceipt(req, res) {
  const { driverId, companyId } = req.driver;
  const [[a]] = await db.execute(
    `SELECT a.storage_path, a.mime_type, a.file_name
       FROM expense_attachments a
       JOIN trip_expenses e ON e.expense_id = a.expense_id
      WHERE a.attachment_id = ? AND a.company_id = ? AND e.submitted_by_driver_id = ?
      LIMIT 1`,
    [Number(req.params.attachmentId), companyId, driverId]
  );
  if (!a) return res.status(404).json({ success: false, message: "Receipt not found." });

  const abs = toAbsolute(a.storage_path);
  if (!fs.existsSync(abs)) {
    return res.status(404).json({ success: false, message: "Receipt file is missing." });
  }
  res.type(a.mime_type);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(a.file_name)}"`);
  fs.createReadStream(abs).pipe(res);
}
