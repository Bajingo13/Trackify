/**
 * fetch, with a deadline.
 *
 * The staff console had no timeout anywhere. A request the server never
 * answered — a stalled proxy, a phone that dropped to no signal mid-request —
 * left its screen on "Loading…" or "Signing in…" indefinitely, with nothing to
 * press and nothing to read.
 *
 * Two things this does that a bare AbortController wrapper would not:
 *
 *   • The deadline covers reading the body, not just the headers. A server can
 *     send its status line and then stall, and `await res.json()` would hang
 *     forever on a response fetch() had already resolved. So the body is
 *     buffered here, under the same deadline, and the caller receives a
 *     Response that is already complete and cannot hang.
 *
 *   • The failure says what happened in words. "Failed to fetch" and
 *     "The user aborted a request" tell nobody anything; a timeout and an
 *     unreachable server are reported as such, with a code the screen can use.
 *
 * Nothing is retried automatically. Most of what this carries is a POST —
 * approving a trip, releasing cargo, saving a receipt — and retrying one of
 * those without asking is how a thing gets done twice.
 */

export const TIMEOUTS = Object.freeze({
  /* A JSON call. The slowest report query measured is well under a second;
   * thirty is room for a bad connection, not for a slow server. */
  request: 30_000,
  /* A receipt or a photograph coming back — up to 8 MB. */
  download: 60_000,
  /* A receipt or a photograph going up. 8 MB at the upload speed of a weak
   * mobile connection takes minutes, and cutting off an upload that was
   * working is worse than waiting for one that was not. */
  upload: 180_000,
});

/* Statuses whose Response is not allowed a body. Building one with a body
 * throws, so these are rebuilt with none. */
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

function failure(message, code, cause) {
  const error = new Error(message);
  error.code = code;
  error.status = 0;
  if (cause) error.cause = cause;
  return error;
}

export async function fetchWithTimeout(url, init = {}, { timeoutMs = TIMEOUTS.request } = {}) {
  const controller = new AbortController();
  let timedOut = false;

  /* A caller's own signal still wins: aborting it aborts this request, and the
   * caller gets its own AbortError back rather than a timeout it did not ask
   * about. */
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener("abort", () => controller.abort(outer.reason), { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });

    /*
     * A stand-in without a real body (a test double built as a plain object)
     * is handed back untouched. Everything a browser returns has arrayBuffer.
     */
    if (typeof res?.arrayBuffer !== "function") return res;

    const body = NULL_BODY.has(res.status) ? null : await res.arrayBuffer();
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } catch (error) {
    if (timedOut) {
      throw failure(
        "The server took too long to answer. Check your connection and try again.",
        "TIMEOUT",
        error
      );
    }
    if (outer?.aborted) throw error;
    if (error instanceof TypeError) {
      // What fetch throws when nothing came back at all: offline, DNS,
      // refused, or blocked before it left the browser.
      throw failure(
        "The server could not be reached. Check your connection and try again.",
        "NETWORK",
        error
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
