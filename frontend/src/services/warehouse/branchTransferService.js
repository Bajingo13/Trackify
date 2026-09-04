import { get, post } from "../apiClient";

export async function getAllTransfers(filters = {}) {
  const res = await get("/warehouse/transfers");
  let rows = res.data || [];
  if (filters.status) rows = rows.filter((t) => t.status === filters.status);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter(
      (t) =>
        (t.transferNo || "").toLowerCase().includes(q) ||
        (t.sourceBranchName || "").toLowerCase().includes(q) ||
        (t.destBranchName || "").toLowerCase().includes(q) ||
        (t.items || []).some((i) => (i.name || "").toLowerCase().includes(q))
    );
  }
  return rows;
}

export async function getTransferById(id) {
  const res = await get(`/warehouse/transfers/${id}`);
  return res.data || null;
}

export async function getTransferStats() {
  const res = await get("/warehouse/transfers/stats");
  return res.data || { total: 0, pending: 0, inTransit: 0, completed: 0, discrepancies: 0 };
}

export async function createTransfer(data) {
  return post("/warehouse/transfers", data);
}
export async function approveTransfer(id) {
  return post(`/warehouse/transfers/${id}/approve`, {});
}
export async function dispatchTransfer(id) {
  return post(`/warehouse/transfers/${id}/dispatch`, {});
}
export async function receiveTransfer(id, received) {
  return post(`/warehouse/transfers/${id}/receive`, { received: received || {} });
}
export async function cancelTransfer(id) {
  return post(`/warehouse/transfers/${id}/cancel`, {});
}
