import { API_ORIGIN } from "./apiOrigin";
import { fetchWithTimeout } from "./fetchWithTimeout";

/**
 * The reset flow, which is the one part of the API used by somebody who is not
 * signed in. It deliberately does not go through apiClient: that helper
 * attaches a token and fires the session-expired event on a 401, neither of
 * which makes sense for a person who cannot sign in at all.
 */

const BASE = `${API_ORIGIN}/api/auth`;

async function call(path, options) {
  const res = await fetchWithTimeout(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    throw Object.assign(new Error(data.message || "Something went wrong. Try again."), {
      status: res.status,
    });
  }
  return data;
}

export function requestPasswordReset(email) {
  return call("/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
}

export function checkResetToken(token) {
  return call(`/reset-password?token=${encodeURIComponent(token)}`, { method: "GET" });
}

export function completePasswordReset(token, newPassword) {
  return call("/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
}
