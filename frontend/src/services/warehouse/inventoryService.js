import { get, post, patch } from "../apiClient";

/** warehouses + branches as one flat list ({ id, code, name, location, locationType }) */
export async function getAllLocations() {
  const res = await get("/warehouse/locations");
  return res.data || [];
}

export async function getAllInventory(filters = {}) {
  const res = await get("/warehouse/inventory");
  let rows = res.data || [];
  if (filters.category) rows = rows.filter((i) => i.category === filters.category);
  if (filters.locationType) rows = rows.filter((i) => i.locationType === filters.locationType);
  if (filters.attention === "low") rows = rows.filter((i) => i.status === "Low Stock" || i.status === "Out of Stock");
  if (filters.attention === "out") rows = rows.filter((i) => i.status === "Out of Stock");
  if (filters.locationId) rows = rows.filter((i) => i.locationId === Number(filters.locationId));
  if (filters.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter(
      (i) =>
        (i.itemId || "").toLowerCase().includes(q) ||
        (i.name || "").toLowerCase().includes(q) ||
        (i.category || "").toLowerCase().includes(q)
    );
  }
  const page = filters.page || 1;
  const limit = filters.limit || 10;
  const total = rows.length;
  return {
    data: rows.slice((page - 1) * limit, page * limit),
    total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getInventoryStats() {
  const res = await get("/warehouse/inventory/stats");
  return res.data || { total: 0, totalValue: 0, lowStock: 0, outOfStock: 0 };
}

export async function getLowStock() {
  const res = await get("/warehouse/inventory/low-stock");
  return res.data || [];
}

export async function getAllStockMovements(filters = {}) {
  const res = await get("/warehouse/movements");
  let rows = res.data || [];
  if (filters.movementType) rows = rows.filter((m) => m.movementType === filters.movementType);
  if (filters.status) rows = rows.filter((m) => m.status === filters.status);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter(
      (m) =>
        (m.referenceNo || "").toLowerCase().includes(q) ||
        (m.itemName || "").toLowerCase().includes(q) ||
        (m.sourceLocationName || "").toLowerCase().includes(q) ||
        (m.destinationLocationName || "").toLowerCase().includes(q)
    );
  }
  return rows;
}

export async function getStockMovementStats() {
  const res = await get("/warehouse/movements/stats");
  return res.data || { total: 0, completed: 0, inTransit: 0, pending: 0 };
}

export async function createStockMovement(data) {
  return post("/warehouse/movements", data);
}
export async function receiveMovement(id) {
  return post(`/warehouse/movements/${id}/receive`, {});
}
export async function cancelMovement(id) {
  return post(`/warehouse/movements/${id}/cancel`, {});
}

/* ---- item catalog ---- */
export async function getItems() {
  const res = await get("/warehouse/items");
  return res.data || [];
}
export async function createItem(data) {
  return post("/warehouse/items", data);
}
export async function updateItem(id, data) {
  return patch(`/warehouse/items/${id}`, data);
}
