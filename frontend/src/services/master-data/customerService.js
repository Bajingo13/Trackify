import { get, post, patch } from "../apiClient";

function qs(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "" && v !== "all") q.set(k, v);
  });
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function listCustomers(filters = {}) {
  const res = await get(`/master-data/customers${qs(filters)}`);
  return { data: res.data || [], pagination: res.pagination };
}

export async function getCustomer(id) {
  const res = await get(`/master-data/customers/${id}`);
  return res.data;
}

export async function createCustomer(payload) {
  return post("/master-data/customers", payload);
}

export async function updateCustomer(id, payload) {
  return patch(`/master-data/customers/${id}`, payload);
}
