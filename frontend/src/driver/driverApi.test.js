import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { driverDeliver, driverPing, driverSendMessage, driverSubmitExpense, driverSupportCreate, setDriverAuth } from "./driverApi";

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
