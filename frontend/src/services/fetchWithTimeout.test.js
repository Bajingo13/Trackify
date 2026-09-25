import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { fetchWithTimeout, TIMEOUTS } from "./fetchWithTimeout"

/**
 * A deadline on every request.
 *
 * Without one, a request the server never answered left its screen on
 * "Loading…" or "Signing in…" indefinitely. The case that matters most is the
 * one a simple wrapper misses: headers arrive, then the body stalls, and the
 * caller's `await res.json()` hangs on a response fetch() already resolved.
 */

/* A response whose body arrives only when told to, and which errors when the
 * request is aborted — which is what a browser's fetch does with its body. */
function stallingFetch() {
  return vi.fn((url, init) => {
    const stream = new ReadableStream({
      start(controller) {
        init.signal.addEventListener("abort", () =>
          controller.error(new DOMException("The operation was aborted.", "AbortError"))
        )
      },
    })
    return Promise.resolve(new Response(stream, { status: 200 }))
  })
}

/* A fetch that never resolves at all, until aborted. */
function silentFetch() {
  return vi.fn((url, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError"))
    )
  }))
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe("a request that does not come back", () => {
  test("a server that never answers is reported as a timeout", async () => {
    globalThis.fetch = silentFetch()
    const pending = fetchWithTimeout("/x", {}, { timeoutMs: 1000 })
    const settled = expect(pending).rejects.toMatchObject({ code: "TIMEOUT", status: 0 })
    await vi.advanceTimersByTimeAsync(1001)
    await settled
  })

  test("headers that arrive with a body that never does are ALSO a timeout", async () => {
    /*
     * The failure a bare AbortController wrapper leaves in place: fetch()
     * resolves, the wrapper clears its timer, and the caller hangs forever on
     * the body.
     */
    globalThis.fetch = stallingFetch()
    const pending = fetchWithTimeout("/x", {}, { timeoutMs: 1000 })
    const settled = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" })
    await vi.advanceTimersByTimeAsync(1001)
    await settled
  })

  test("the message says what happened in words", async () => {
    globalThis.fetch = silentFetch()
    const pending = fetchWithTimeout("/x", {}, { timeoutMs: 500 })
    const settled = expect(pending).rejects.toThrow(/took too long to answer/)
    await vi.advanceTimersByTimeAsync(501)
    await settled
  })

  test("nothing coming back at all is reported as unreachable, not as 'Failed to fetch'", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    await expect(fetchWithTimeout("/x")).rejects.toMatchObject({
      code: "NETWORK",
      message: expect.stringMatching(/could not be reached/),
    })
  })
})

describe("a request that does come back", () => {
  test("status, headers and body pass through unchanged", async () => {
    vi.useRealTimers()
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: 1 }), {
        status: 201,
        headers: { "X-Trace": "abc", "Content-Type": "application/json" },
      })
    )
    const res = await fetchWithTimeout("/x")
    expect(res.status).toBe(201)
    expect(res.ok).toBe(true)
    expect(res.headers.get("X-Trace")).toBe("abc")
    expect(await res.json()).toEqual({ ok: 1 })
  })

  test("an error status is returned, not thrown — the caller decides", async () => {
    // The API client turns 401 into a sign-out and 403 into a message. That
    // only works if a 4xx arrives as a response.
    vi.useRealTimers()
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "nope" }), { status: 403 })
    )
    const res = await fetchWithTimeout("/x")
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ message: "nope" })
  })

  test("a 204 with no body does not throw while being rebuilt", async () => {
    // A Response with a null-body status cannot be constructed with a body.
    vi.useRealTimers()
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const res = await fetchWithTimeout("/x")
    expect(res.status).toBe(204)
  })

  test("a binary body survives intact", async () => {
    vi.useRealTimers()
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }))
    const res = await fetchWithTimeout("/x")
    const back = new Uint8Array(await (await res.blob()).arrayBuffer())
    expect([...back]).toEqual([...bytes])
  })

  test("the timer is cleared once the request settles", async () => {
    vi.useRealTimers()
    const clear = vi.spyOn(globalThis, "clearTimeout")
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    await fetchWithTimeout("/x")
    expect(clear).toHaveBeenCalled()
  })
})

describe("the caller's own intent", () => {
  test("a caller aborting its own request gets its own abort back, not a timeout", async () => {
    vi.useRealTimers()
    globalThis.fetch = silentFetch()
    const mine = new AbortController()
    const pending = fetchWithTimeout("/x", { signal: mine.signal }, { timeoutMs: 60_000 })
    mine.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })

  test("the limits are the documented ones", () => {
    expect(TIMEOUTS.request).toBe(30_000)
    expect(TIMEOUTS.download).toBe(60_000)
    expect(TIMEOUTS.upload).toBe(180_000)
  })
})
