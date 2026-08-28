import { get, post, patch } from "../apiClient";

function qs(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "" && v !== "all") q.set(k, v);
  });
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function listBranches(filters = {}) {
  const res = await get(`/admin/branches${qs(filters)}`);
  return res.data || [];
}

export async function getBranch(id) {
  const res = await get(`/admin/branches/${id}`);
  return res.data;
}

export async function createBranch(payload) {
  return post("/admin/branches", payload);
}

export async function updateBranch(id, payload) {
  return patch(`/admin/branches/${id}`, payload);
}
