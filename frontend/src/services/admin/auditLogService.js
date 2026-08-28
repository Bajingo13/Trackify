import { get } from "../apiClient";

function qs(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "" && v !== "all") q.set(k, v);
  });
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function listAuditLogs(filters = {}) {
  const res = await get(`/admin/audit-logs${qs(filters)}`);
  return { data: res.data || [], pagination: res.pagination };
}
