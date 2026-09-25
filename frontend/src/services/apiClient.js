// The versioned API prefix is appended here so it stays in one place.
import { API_ORIGIN } from "./apiOrigin";
import { fetchWithTimeout, TIMEOUTS } from "./fetchWithTimeout";

const API_BASE = `${API_ORIGIN}/api/v1`;

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

  // Bounded, body included: the response below is already complete, so the
  // .json() that follows cannot hang, and a failure that swallowed it could
  // only ever be malformed JSON — never a timeout silently read as `{}`.
  const res = await fetchWithTimeout(url, { ...options, headers });

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

  if (res.status === 403 && data.code === "PASSWORD_CHANGE_REQUIRED") {
    window.dispatchEvent(new CustomEvent("ttms:password-change-required"));
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

/**
 * Fetches a binary response (a receipt image or PDF) as a data: URL.
 * Receipts sit behind an authenticated route, so they cannot simply be put in
 * an <img src>. A data URL rather than an object URL deliberately: object
 * URLs have to be revoked, and getting that wrong under StrictMode revokes
 * the image out from under the element that is still decoding it.
 */
export async function getDataUrl(path) {
  const res = await fetchWithTimeout(
    `${API_BASE}${path}`,
    { headers: getAuthHeaders() },
    { timeoutMs: TIMEOUTS.download }
  );
  if (!res.ok) {
    const error = new Error(res.status === 404 ? "That file is no longer available." : "Could not load that file.");
    error.status = res.status;
    throw error;
  }
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(blob);
  });
}

/**
 * A multipart upload.
 *
 * Content-Type is taken from the JSON headers rather than added to, because
 * multipart needs a boundary that only the browser can generate — setting the
 * header by hand produces a request the server cannot parse, and the error it
 * gives back does not say so.
 */
export async function postForm(path, form) {
  const headers = getAuthHeaders();
  delete headers["Content-Type"];

  const res = await fetchWithTimeout(
    `${API_BASE}${path}`,
    { method: "POST", headers, body: form },
    { timeoutMs: TIMEOUTS.upload }
  );
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("ttms:session-expired"));
    throw Object.assign(new Error(data.message || "Your session has expired. Please sign in again."), { status: 401 });
  }
  if (res.status === 403 && data.code === "PASSWORD_CHANGE_REQUIRED") {
    window.dispatchEvent(new CustomEvent("ttms:password-change-required"));
  }
  if (!res.ok) {
    throw Object.assign(new Error(data.message || "Could not upload that."), { status: res.status });
  }
  return data;
}

export default { get, post, patch, put, del, getDataUrl, postForm };
