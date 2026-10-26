import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enqueue: vi.fn(),
  online: false,
}));

vi.mock("./offlineQueue", () => ({
  enqueue: (...args) => state.enqueue(...args),
  flush: vi.fn(),
  isOnline: () => state.online,
}));
vi.mock("../services/apiOrigin", () => ({ API_ORIGIN: "https://api.trackify.test" }));

import {
  driverDeliver, driverMe, driverPing, driverSendMessage, driverStart, driverSubmitExpense, driverSupportCreate, setDriverAuth,
  REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS,
} from "./driverApi";
import { cachedEmergencyLine } from "./emergencyLine";

describe("the emergency line travels with the profile", () => {
  beforeEach(() => {
    localStorage.clear();
    setDriverAuth({ token: "driver-token", driver: { driverId: 7 } });
    vi.restoreAllMocks();
  });

  it("keeps the line on the phone each time the profile loads", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true, data: { name: "Juan", emergencyLine: { number: "(082) 224-1234", isDemo: false } },
    }), { status: 200 }));
    await driverMe();
    expect(cachedEmergencyLine(7)).toMatchObject({ number: "(082) 224-1234", isDemo: false });
  });

  it("keeps the copy it has when a profile comes back without the line", async () => {
    localStorage.setItem("trackify-driver-emergency-line:7", JSON.stringify({ number: "911", isDemo: false }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true, data: { name: "Juan" },
    }), { status: 200 }));
    await driverMe();
    expect(cachedEmergencyLine(7)).toMatchObject({ number: "911" });
  });
});

describe("driver road-work durability", () => {
  beforeEach(() => {
    localStorage.clear();
    setDriverAuth({ token: "driver-token", driver: { driverId: 7 } });
    state.online = false;
    state.enqueue.mockReset();
  });

  it("reports queued only after IndexedDB actually accepted the update", async () => {
    state.enqueue.mockResolvedValue(true);
    await expect(driverPing(41, { lat: 7.07, lng: 125.61 })).resolves.toEqual({ queued: true });
    expect(state.enqueue).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 7 }));
  });

  it("surfaces a storage failure instead of claiming the update was saved", async () => {
    state.enqueue.mockResolvedValue(false);
    await expect(driverPing(41, { lat: 7.07, lng: 125.61 }))
      .rejects.toThrow("Could not send or save this update on the phone");
  });
});

describe("office-facing actions need a connection", () => {
  beforeEach(() => {
    localStorage.clear();
    setDriverAuth({ token: "driver-token", driver: { driverId: 7 } });
    state.enqueue.mockReset();
    state.enqueue.mockResolvedValue(true);
    vi.restoreAllMocks();
  });

  it("refuses a request, a message and a claim offline instead of saving them", async () => {
    state.online = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(driverSupportCreate({ kind: "other", body: "x" })).rejects.toMatchObject({ offline: true });
    await expect(driverSendMessage(41, "hello", "ref-1")).rejects.toMatchObject({ offline: true });
    await expect(driverSubmitExpense(41, new FormData())).rejects.toMatchObject({ offline: true });
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not save a message that failed in transit either", async () => {
    state.online = true;
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(driverSendMessage(41, "hello", "ref-1")).rejects.toMatchObject({ offline: true });
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it("does not call an expired session 'offline': the server answered", async () => {
    state.online = true;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const err = await driverSendMessage(41, "hello", "ref-1").catch((e) => e);
    expect(err.message).toBe("Session expired");
    expect(err.status).toBe(401);
    expect(err.offline).toBeUndefined();
  });

  it("does not call a server refusal 'offline' either", async () => {
    state.online = true;
    setDriverAuth({ token: "driver-token", driver: { driverId: 7 } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "Too long." }), { status: 400 }));
    await expect(driverSendMessage(41, "hello", "ref-1")).rejects.toMatchObject({ status: 400, message: "Too long." });
  });

  it("takes a redirect (a captive portal's login page) as no connection", async () => {
    state.online = true;
    const res = new Response("<html></html>", { status: 200 });
    Object.defineProperty(res, "redirected", { value: true });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(res);
    await expect(driverSendMessage(41, "hello", "ref-1")).rejects.toMatchObject({ offline: true });
  });

  it("still saves trip progress offline, so a delivery in a dead zone is kept", async () => {
    state.online = false;
    await expect(driverDeliver(41, new FormData())).resolves.toEqual({ queued: true });
    expect(state.enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: "deliver" }));
  });
});

describe("a request that never hears back", () => {
  beforeEach(() => {
    localStorage.clear();
    setDriverAuth({ token: "driver-token", driver: { driverId: 7 } });
    state.online = true;
    state.enqueue.mockReset().mockResolvedValue(true);
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  // one bar of signal, or wifi behind a login page: the request goes out and nothing comes back
  const hangingFetch = () => vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));

  it("gives up after 20 seconds and saves trip progress on the phone, to be sent again", async () => {
    hangingFetch();
    const started = driverStart(41);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await expect(started).resolves.toEqual({ queued: true });
    expect(state.enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: "start" }));
  });

  it("gives an upload longer, then saves the delivery on the phone", async () => {
    hangingFetch();
    const delivered = driverDeliver(41, new FormData());
    let settled = false;
    delivered.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - REQUEST_TIMEOUT_MS);
    await expect(delivered).resolves.toEqual({ queued: true });
  });

  it("says no connection for something that must be sent live, and keeps nothing", async () => {
    hangingFetch();
    const sent = driverSendMessage(41, "hello", "ref-1").catch((e) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await sent).toMatchObject({ offline: true });
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it("still sends the phone's key, so the timeout changes nothing about sign-in", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await driverStart(41);
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers["X-Driver-Device"]).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(init.headers.Authorization).toBe("Bearer driver-token");
    expect(init.signal).toBeDefined();
  });

  it("an answer in time is used as before, and no timer is left running", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ success: true, data: { status: "in_transit", alreadyDone: true } }), { status: 200 }));
    // the first answer can bring netStatus back online, which schedules its own check
    await driverStart(41);
    const before = vi.getTimerCount();
    await expect(driverStart(41)).resolves.toMatchObject({ data: { alreadyDone: true } });
    expect(vi.getTimerCount()).toBe(before);
    expect(state.enqueue).not.toHaveBeenCalled();
  });
});
