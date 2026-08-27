const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api/v1";

function getAuthHeaders() {
  const raw = localStorage.getItem("ttms_auth");
  const user = raw ? JSON.parse(raw) : null;

  const headers = {
    "Content-Type": "application/json",
  };

  if (user?.token) {
    headers["Authorization"] = `Bearer ${user.token}`;
  }

  const companyId = localStorage.getItem("ttms_company_id") || "1";
  const branchId = localStorage.getItem("ttms_branch_id") || "1";

  headers["X-Company-Id"] = companyId;
  headers["X-Branch-Id"] = branchId;

  return headers;
}

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { ...getAuthHeaders(), ...options.headers };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json();

  if (!res.ok) {
    const error = new Error(data.message || "Request failed");
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

export function get(path) {
  return request(path, { method: "GET" });
}

export function post(path, body) {
  return request(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patch(path, body) {
  return request(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function del(path) {
  return request(path, { method: "DELETE" });
}

export default { get, post, patch, del };
