import { get, post, patch, put, del } from "../apiClient";

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
  return { data: res.data || [], pagination: res.pagination };
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

export async function issueTemporaryPassword(id) {
  const res = await post(`/admin/users/${id}/temporary-password`, {});
  return res.data;
}

export async function setUserRoles(id, roleIds) {
  return put(`/admin/users/${id}/roles`, { roleIds });
}

export async function grantUserAccess(id, payload) {
  return post(`/admin/users/${id}/access`, payload);
}

/** Flip one access record active/inactive in place — no need to re-grant to restore it. */
export async function setUserAccessStatus(id, accessId, status) {
  return patch(`/admin/users/${id}/access/${accessId}`, { status });
}

/** A fresh invitation for someone who has not accepted yet; the old link stops working. */
export async function resendInvitation(id) {
  const res = await post(`/admin/users/${id}/invitation`, {});
  return res.data;
}

/** Permanent. Only for inactive or invited accounts with no history; the server says why otherwise. */
export async function deleteUser(id) {
  return del(`/admin/users/${id}`);
}
