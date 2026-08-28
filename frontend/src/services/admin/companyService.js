import { get, post, patch } from "../apiClient";

function qs(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "" && v !== "all") q.set(k, v);
  });
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function listCompanies(filters = {}) {
  const res = await get(`/admin/companies${qs(filters)}`);
  return res.data || [];
}

export async function getCompany(id) {
  const res = await get(`/admin/companies/${id}`);
  return res.data;
}

export async function createCompany(payload) {
  return post("/admin/companies", payload);
}

export async function updateCompany(id, payload) {
  return patch(`/admin/companies/${id}`, payload);
}
