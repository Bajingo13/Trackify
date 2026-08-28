// VITE_API_URL is the backend origin only (e.g. http://localhost:5000).
// The versioned API prefix is appended here so it stays in one place.
const API_ORIGIN = import.meta.env.VITE_API_URL || "http://localhost:5000";
const API_BASE = `${API_ORIGIN.replace(/\/+$/, "")}/api/v1`;

function getAuthHeaders() {
  let user = null;
  try {
    const raw = localStorage.getItem("ttms_auth");
    user = raw ? JSON.parse(raw) : null;
  } catch {
    user = null;
  }

  const headers = { "Content-Type": "application/json" };
  if (user?.token) headers["Authorization"] = `Bearer ${user.token}`;

  headers["X-Company-Id"] = localStorage.getItem("ttms_company_id") || "";
  headers["X-Branch-Id"] = localStorage.getItem("ttms_branch_id") || "";
  return headers;
}

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { ...getAuthHeaders(), ...options.headers };

  const res = await fetch(url, { ...options, headers });

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty / non-JSON body */
  }

  if (res.status === 401) {
    // Token missing / expired / invalid — end the session consistently.
    window.dispatchEvent(new CustomEvent("ttms:session-expired"));
    const error = new Error(data.message || "Your session has expired. Please sign in again.");
    error.status = 401;
    throw error;
  }

  if (!res.ok) {
    const error = new Error(
      data.message ||
        (res.status === 403
          ? "You don't have permission to do that."
          : "Request failed")
    );
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

export function put(path, body) {
  return request(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function del(path) {
  return request(path, { method: "DELETE" });
}

export default { get, post, patch, put, del };
