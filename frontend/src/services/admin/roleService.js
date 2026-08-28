import { get, post, patch, put } from "../apiClient";

export async function listRoles() {
  const res = await get("/admin/roles");
  return res.data || [];
}

export async function getRole(id) {
  const res = await get(`/admin/roles/${id}`);
  return res.data;
}

export async function listPermissions() {
  const res = await get("/admin/permissions");
  return res.data || [];
}

export async function createRole(payload) {
  return post("/admin/roles", payload);
}

export async function updateRole(id, payload) {
  return patch(`/admin/roles/${id}`, payload);
}

export async function setRolePermissions(id, permissionIds) {
  return put(`/admin/roles/${id}/permissions`, { permissionIds });
}
