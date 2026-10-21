import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/apiOrigin", () => ({ API_ORIGIN: "https://api.trackify.test" }));
vi.mock("./native", () => ({ onNativeNetworkChange: () => () => {} }));

import { checkNow, getNetState, PROBE_URL, reportFailure, reportSuccess, resetNetStatus, subscribe } from "./netStatus";

const setOsOnline = (v) => Object.defineProperty(navigator, "onLine", { value: v, configurable: true });

/* A probe that answers after `ms`. */
const answersIn = (ms) => vi.fn(() => new Promise((r) => setTimeout(() => r(new Response(null, { status: 204 })), ms)));

describe("netStatus", () => {
  let off = () => {};
  beforeEach(() => {
    vi.useFakeTimers();
    setOsOnline(true);
    resetNetStatus("online");
  });
  afterEach(() => {
    off();
    off = () => {};
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("asks the probe URL, uncached", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(answersIn(10));
    const done = checkNow();
    await vi.advanceTimersByTimeAsync(10);
    await done;
    expect(PROBE_URL).toBe("https://api.trackify.test/api/health/live");
    expect(fetchSpy).toHaveBeenCalledWith(PROBE_URL, expect.objectContaining({ cache: "no-store" }));
  });

  it("goes offline the moment the phone loses its network", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(answersIn(10)); // never the real network
    off = subscribe(() => {});
    setOsOnline(false);
    window.dispatchEvent(new Event("offline"));
    expect(getNetState()).toBe("offline");
  });

  it("does not believe the phone's 'online' until the server answers", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    resetNetStatus("offline");
    off = subscribe(() => {});
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(getNetState()).toBe("offline");

    globalThis.fetch.mockImplementation(answersIn(50));
    await vi.advanceTimersByTimeAsync(60_000); // the backed-off retry
    expect(getNetState()).toBe("online");
  });

  it("calls a slow answer unstable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(answersIn(3000));
    const done = checkNow();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(done).resolves.toBe("unstable");
  });

  it("does not take a captive portal's page for the server", async () => {
    resetNetStatus("offline");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>Sign in to Wi-Fi</html>", { status: 200 }));
    await expect(checkNow()).resolves.toBe("offline");
  });

  it("probes a link that stays slow less and less often", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(answersIn(3000));
    off = subscribe(() => {});
    await vi.advanceTimersByTimeAsync(3000);
    expect(getNetState()).toBe("unstable");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // 5s, then 3s to answer: the second probe
    await vi.advanceTimersByTimeAsync(8000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // still slow: the next waits 10s, not 5s
    await vi.advanceTimersByTimeAsync(8000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("takes one failure as unstable and two as offline", () => {
    reportFailure();
    expect(getNetState()).toBe("unstable");
    reportFailure();
    expect(getNetState()).toBe("offline");
  });

  it("comes back from offline on any real answer from the API", () => {
    resetNetStatus("offline");
    reportSuccess();
    expect(getNetState()).toBe("online");
  });

  it("backs off between probes while the server cannot be reached", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    off = subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // on subscribe
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // 10s after the first failure
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // the next waits 20s
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
