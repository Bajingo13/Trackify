import { logAudit } from "../auditService";

let nextId = 100;

const branchTransfers = [
  {
    id: 1, transferNo: "BT-2026-001",
    sourceBranchId: 1, sourceBranchName: "Makati Branch",
    destBranchId: 2, destBranchName: "Cebu Branch",
    items: [
      { itemId: "ITEM-001", name: "Engine Oil 5W-40 (4L)", expectedQty: 20, scannedQty: 20, receivedQty: 20, status: "Confirmed" },
      { itemId: "ITEM-004", name: "Fuel Filter (Diesel)", expectedQty: 30, scannedQty: 30, receivedQty: 30, status: "Confirmed" },
    ],
    status: "Completed",
    requestedBy: "Super Admin",
    approvedBy: "Fleet Admin",
    sourceConfirmed: true,
    destConfirmed: true,
    sourceConfirmedAt: "2026-02-10",
    destConfirmedAt: "2026-02-12",
    notes: "Regular branch supply transfer",
    createdAt: "2026-02-09",
  },
  {
    id: 2, transferNo: "BT-2026-002",
    sourceBranchId: 1, sourceBranchName: "Makati Branch",
    destBranchId: 3, destBranchName: "Davao Branch",
    items: [
      { itemId: "ITEM-003", name: "NS40Z Battery", expectedQty: 5, scannedQty: 5, receivedQty: 5, status: "Confirmed" },
      { itemId: "ITEM-005", name: "Tire 225/70R17.5", expectedQty: 8, scannedQty: 6, receivedQty: 6, status: "Discrepancy" },
    ],
    status: "In Transit",
    requestedBy: "Super Admin",
    approvedBy: "Fleet Admin",
    sourceConfirmed: true,
    destConfirmed: false,
    sourceConfirmedAt: "2026-02-14",
    destConfirmedAt: null,
    notes: "Discrepancy detected on tire count",
    createdAt: "2026-02-13",
  },
  {
    id: 3, transferNo: "BT-2026-003",
    sourceBranchId: 4, sourceBranchName: "Clark Branch",
    destBranchId: 1, destBranchName: "Makati Branch",
    items: [
      { itemId: "ITEM-007", name: "Transmission Fluid ATF", expectedQty: 10, scannedQty: null, receivedQty: null, status: "Pending" },
    ],
    status: "Pending",
    requestedBy: "Super Admin",
    approvedBy: null,
    sourceConfirmed: false,
    destConfirmed: false,
    sourceConfirmedAt: null,
    destConfirmedAt: null,
    notes: "",
    createdAt: "2026-02-15",
  },
];

export function getAllTransfers(filters = {}) {
  let result = [...branchTransfers];
  if (filters.status) result = result.filter((t) => t.status === filters.status);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (t) =>
        t.transferNo.toLowerCase().includes(q) ||
        t.sourceBranchName.toLowerCase().includes(q) ||
        t.destBranchName.toLowerCase().includes(q) ||
        t.items.some((i) => i.name.toLowerCase().includes(q))
    );
  }
  return result;
}

export function getTransferById(id) {
  return branchTransfers.find((t) => t.id === id) || null;
}

export function createTransfer(data) {
  const transfer = {
    id: nextId++,
    transferNo: `BT-${new Date().getFullYear()}-${String(nextId).padStart(3, "0")}`,
    ...data,
    items: data.items.map((i) => ({ ...i, scannedQty: null, receivedQty: null, status: "Pending" })),
    status: "Pending",
    sourceConfirmed: false,
    destConfirmed: false,
    sourceConfirmedAt: null,
    destConfirmedAt: null,
    createdAt: new Date().toISOString().split("T")[0],
  };
  branchTransfers.unshift(transfer);
  logAudit({ module: "Warehouse", action: "Transfer Created", referenceId: transfer.id, newValue: transfer });
  return transfer;
}

export function approveTransfer(id, approvedBy) {
  const transfer = branchTransfers.find((t) => t.id === id);
  if (!transfer) return { success: false, message: "Transfer not found." };
  if (transfer.status !== "Pending") return { success: false, message: "Transfer already processed." };
  transfer.status = "Approved";
  transfer.approvedBy = approvedBy || "Fleet Admin";
  logAudit({ module: "Warehouse", action: "Transfer Approved", referenceId: id, newValue: { status: "Approved", approvedBy: transfer.approvedBy } });
  return { success: true, transfer };
}

export function confirmSource(id) {
  const transfer = branchTransfers.find((t) => t.id === id);
  if (!transfer) return { success: false, message: "Transfer not found." };
  transfer.sourceConfirmed = true;
  transfer.sourceConfirmedAt = new Date().toISOString().split("T")[0];
  transfer.status = "In Transit";
  logAudit({ module: "Warehouse", action: "Transfer Source Confirmed", referenceId: id });
  return { success: true, transfer };
}

export function scanItem(transferId, itemId, scannedQty) {
  const transfer = branchTransfers.find((t) => t.id === transferId);
  if (!transfer) return { success: false, message: "Transfer not found." };
  const item = transfer.items.find((i) => i.itemId === itemId);
  if (!item) return { success: false, message: "Item not found in transfer." };
  item.scannedQty = scannedQty;
  if (scannedQty === item.expectedQty) {
    item.status = "Confirmed";
  } else if (scannedQty < item.expectedQty) {
    item.status = "Discrepancy";
  } else {
    item.status = "Over";
  }
  logAudit({ module: "Warehouse", action: "Transfer Scan", referenceId: transferId, newValue: { itemId, scannedQty, itemStatus: item.status } });
  return { success: true, item };
}

export function confirmDestination(id) {
  const transfer = branchTransfers.find((t) => t.id === id);
  if (!transfer) return { success: false, message: "Transfer not found." };

  const hasDiscrepancy = transfer.items.some((i) => i.status === "Discrepancy" || i.status === "Pending");
  if (hasDiscrepancy) {
    return { success: false, message: "Cannot confirm: some items have discrepancies or haven't been scanned." };
  }

  transfer.items.forEach((i) => {
    i.receivedQty = i.scannedQty;
    i.status = "Confirmed";
  });
  transfer.destConfirmed = true;
  transfer.destConfirmedAt = new Date().toISOString().split("T")[0];
  transfer.status = "Completed";
  logAudit({ module: "Warehouse", action: "Transfer Completed", referenceId: id, newValue: { status: "Completed", destConfirmedAt: transfer.destConfirmedAt } });
  return { success: true, transfer };
}

export function getTransferStats() {
  const total = branchTransfers.length;
  const pending = branchTransfers.filter((t) => t.status === "Pending").length;
  const inTransit = branchTransfers.filter((t) => t.status === "In Transit").length;
  const completed = branchTransfers.filter((t) => t.status === "Completed").length;
  const discrepancies = branchTransfers.filter((t) => t.items.some((i) => i.status === "Discrepancy")).length;
  return { total, pending, inTransit, completed, discrepancies };
}
