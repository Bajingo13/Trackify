import { get, post, patch, put } from "../apiClient";

function qs(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "" && v !== "all") q.set(k, v);
  });
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function listUsers(filters = {}) {
  const res = await get(`/admin/users${qs(filters)}`);
  return res.data || [];
}

export async function getUser(id) {
  const res = await get(`/admin/users/${id}`);
  return res.data;
}

export async function createUser(payload) {
  return post("/admin/users", payload);
}

export async function updateUser(id, payload) {
  return patch(`/admin/users/${id}`, payload);
}

export async function setUserRoles(id, roleIds) {
  return put(`/admin/users/${id}/roles`, { roleIds });
}
