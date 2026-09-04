import { get, post, patch } from "./apiClient";

function crud(base) {
  return {
    list: async (params = {}) => {
      const q = new URLSearchParams();
      if (params.search) q.set("search", params.search);
      if (params.status) q.set("status", params.status);
      const res = await get(`/master-data/${base}${q.toString() ? `?${q}` : ""}`);
      return res.data || [];
    },
    create: (data) => post(`/master-data/${base}`, data),
    update: (id, data) => patch(`/master-data/${base}/${id}`, data),
  };
}

export const supplierService = crud("suppliers");
export const accountService = crud("chart-of-accounts");
export const warehouseMdService = crud("warehouses");
export const taxCodeService = crud("tax-codes");

// Items master reuses the warehouse item-catalog controller. Its list returns
// camelCase rows keyed by `id` and ignores the search param, so filter here.
export const itemMdService = {
  list: async ({ search } = {}) => {
    const res = await get("/master-data/items");
    let rows = res.data || [];
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (i) =>
          (i.itemId || "").toLowerCase().includes(q) ||
          (i.name || "").toLowerCase().includes(q) ||
          (i.category || "").toLowerCase().includes(q)
      );
    }
    return rows;
  },
  create: (data) => post("/master-data/items", data),
  update: (id, data) => patch(`/master-data/items/${id}`, data),
};
