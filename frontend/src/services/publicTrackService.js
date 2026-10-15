import { API_ORIGIN } from "./apiOrigin";
import { fetchWithTimeout, TIMEOUTS } from "./fetchWithTimeout";

/**
 * A customer's view of one delivery, by the secret in the link they were sent.
 *
 * Deliberately not built on apiClient: there is no signed-in person here, and
 * sending the office's token or company headers to a public page would be the
 * wrong thing to do even if someone happened to be signed in on this browser.
 *
 * Resolves with the view, or `{ gone: true }` when the link is unknown, revoked or
 * expired (the server answers all three the same way, so this page can too).
 */
export async function getPublicTracking(token, { signal } = {}) {
  const res = await fetchWithTimeout(
    `${API_ORIGIN}/api/public/track/${encodeURIComponent(token)}`,
    { headers: { Accept: "application/json" }, credentials: "omit", cache: "no-store", ...(signal ? { signal } : {}) },
    { timeoutMs: TIMEOUTS.request },
  );
  if (res.status === 404) return { gone: true };
  if (res.status === 429) {
    throw Object.assign(new Error("Too many refreshes. Please wait a minute."), { status: 429 });
  }
  let body = {};
  try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok || !body.data) {
    throw Object.assign(new Error(body.message || "Could not load the delivery."), { status: res.status });
  }
  return { view: body.data };
}
