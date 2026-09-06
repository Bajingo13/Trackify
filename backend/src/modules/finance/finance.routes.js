import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as expenses from "./expenses.controller.js";
import * as vouchers from "./vouchers.controller.js";
import * as invoices from "./invoices.controller.js";
import * as journal from "./journal.controller.js";
import * as bir from "./bir.controller.js";

/*
 * Finance module. Mounted at /api/v1/finance by src/routes.js
 * (with authenticate + operationalContext).
 */
const router = express.Router();

/* ---- Trip expenses ---- */
router.get("/expenses", requirePermission("expense.read"), asyncHandler(expenses.listExpenses));
router.get("/expenses/stats", requirePermission("expense.read"), asyncHandler(expenses.expenseStats));
router.post("/expenses", requirePermission("expense.manage"), asyncHandler(expenses.createExpense));
router.patch("/expenses/:id", requirePermission("expense.manage"), asyncHandler(expenses.updateExpense));
router.delete("/expenses/:id", requirePermission("expense.manage"), asyncHandler(expenses.deleteExpense));

/* Driver claims arrive as `submitted` and only enter the books once approved.
 * Reuses expense.manage, which Branch Manager and Finance Officer already hold. */
router.post("/expenses/:id/approve", requirePermission("expense.manage"), asyncHandler(expenses.approveExpense));
router.post("/expenses/:id/reject", requirePermission("expense.manage"), asyncHandler(expenses.rejectExpense));
router.get("/expenses/receipts/:attachmentId", requirePermission("expense.read"), asyncHandler(expenses.getReceipt));

/* ---- Expense vouchers ---- */
router.get("/vouchers", requirePermission("voucher.read"), asyncHandler(vouchers.listVouchers));
router.get("/vouchers/stats", requirePermission("voucher.read"), asyncHandler(vouchers.voucherStats));
router.get("/vouchers/:id", requirePermission("voucher.read"), asyncHandler(vouchers.getVoucher));
router.post("/vouchers", requirePermission("voucher.manage"), asyncHandler(vouchers.createVoucher));
router.patch("/vouchers/:id", requirePermission("voucher.manage"), asyncHandler(vouchers.updateVoucher));
router.post("/vouchers/:id/submit", requirePermission("voucher.manage"), asyncHandler(vouchers.submitVoucher));
router.post("/vouchers/:id/approve", requirePermission("voucher.approve"), asyncHandler(vouchers.approveVoucher));
router.post("/vouchers/:id/reject", requirePermission("voucher.approve"), asyncHandler(vouchers.rejectVoucher));
router.post("/vouchers/:id/pay", requirePermission("voucher.approve"), asyncHandler(vouchers.payVoucher));
router.delete("/vouchers/:id", requirePermission("voucher.manage"), asyncHandler(vouchers.deleteVoucher));

/* ---- Invoices (accounts receivable) ---- */
router.get("/invoices", requirePermission("invoice.read"), asyncHandler(invoices.listInvoices));
router.get("/invoices/stats", requirePermission("invoice.read"), asyncHandler(invoices.invoiceStats));
router.get("/invoices/:id", requirePermission("invoice.read"), asyncHandler(invoices.getInvoice));
router.post("/invoices", requirePermission("invoice.manage"), asyncHandler(invoices.createInvoice));
router.patch("/invoices/:id", requirePermission("invoice.manage"), asyncHandler(invoices.updateInvoice));
router.post("/invoices/:id/send", requirePermission("invoice.manage"), asyncHandler(invoices.sendInvoice));
router.post("/invoices/:id/payment", requirePermission("invoice.manage"), asyncHandler(invoices.recordPayment));
router.post("/invoices/:id/void", requirePermission("invoice.manage"), asyncHandler(invoices.voidInvoice));

/* ---- Journal entries ---- */
router.get("/journal", requirePermission("journal.read"), asyncHandler(journal.listEntries));
router.get("/journal/stats", requirePermission("journal.read"), asyncHandler(journal.entryStats));
router.get("/journal/:id", requirePermission("journal.read"), asyncHandler(journal.getEntry));
router.post("/journal", requirePermission("journal.manage"), asyncHandler(journal.createEntry));
router.patch("/journal/:id", requirePermission("journal.manage"), asyncHandler(journal.updateEntry));
router.post("/journal/:id/post", requirePermission("journal.manage"), asyncHandler(journal.postEntry));
router.post("/journal/:id/void", requirePermission("journal.manage"), asyncHandler(journal.voidEntry));
router.delete("/journal/:id", requirePermission("journal.manage"), asyncHandler(journal.deleteEntry));

/* ---- BIR / EIS register ---- */
router.get("/bir", requirePermission("bir.read"), asyncHandler(bir.listRecords));
router.get("/bir/stats", requirePermission("bir.read"), asyncHandler(bir.recordStats));
router.post("/bir", requirePermission("bir.manage"), asyncHandler(bir.createRecord));
router.patch("/bir/:id", requirePermission("bir.manage"), asyncHandler(bir.updateRecord));
router.delete("/bir/:id", requirePermission("bir.manage"), asyncHandler(bir.deleteRecord));

export default router;
