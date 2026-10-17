import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  driverId: 7,
  background: true,
  trip: vi.fn(),
  ping: vi.fn(),
  startTracking: vi.fn(),
  stopTracking: vi.fn(),
  onFix: null,
  onError: null,
}));

vi.mock("./driverApi", () => ({
  currentDriverId: () => state.driverId,
  driverTrip: (...args) => state.trip(...args),
  driverPing: (...args) => state.ping(...args),
}));
vi.mock("./tracking", () => ({
  startTracking: (...args) => state.startTracking(...args),
  stopTracking: (...args) => state.stopTracking(...args),
  tracksInBackground: () => state.background,
  PERMISSION_OFF: "permission off",
}));
vi.mock("./capabilities", () => ({ canShareLocation: () => true, isInsecureLan: () => false }));

import {
  RESUME_NEEDS_TAP, STATUS_CHECK_MS, getLocationSession, resetLocationSessionForTests,
  resumeSharing, startSharing, stopSharing,
} from "./locationSession";

const saved = (driverId = 7) => JSON.parse(localStorage.getItem(`trackify-driver-sharing:${driverId}`) || "null");
const save = (tripId, driverId = 7) =>
  localStorage.setItem(`trackify-driver-sharing:${driverId}`, JSON.stringify({ tripId }));

function permission(value) {
  Object.defineProperty(navigator, "permissions", {
    value: { query: vi.fn(async () => ({ state: value })) },
    configurable: true,
  });
}

describe("location sharing for the whole app", () => {
  beforeEach(() => {
    resetLocationSessionForTests();
    localStorage.clear();
    state.driverId = 7;
    state.background = true;
    state.trip.mockReset().mockResolvedValue({ id: 41, status: "in_transit" });
    state.ping.mockReset().mockResolvedValue({ data: {} });
    state.stopTracking.mockReset().mockResolvedValue(undefined);
    state.startTracking.mockReset().mockImplementation(async (onFix, onError) => {
      state.onFix = onFix;
      state.onError = onError;
      return true;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    delete navigator.permissions;
  });

  it("remembers the trip on the phone, for this driver, once sharing starts", async () => {
    await startSharing(41);
    expect(getLocationSession()).toMatchObject({ tripId: 41, sharing: true });
    expect(saved(7)).toEqual({ tripId: 41 });
  });

  it("forgets it when the driver turns sharing off or signs out", async () => {
    await startSharing(41);
    stopSharing();
    expect(state.stopTracking).toHaveBeenCalled();
    expect(saved(7)).toBeNull();
    expect(getLocationSession()).toMatchObject({ tripId: null, sharing: false, error: "" });
  });

  describe("reopening the app", () => {
    it("resumes the trip that was being shared, without asking for permission", async () => {
      save(41);
      await expect(resumeSharing()).resolves.toBe(true);
      expect(state.startTracking).toHaveBeenCalledTimes(1);
      expect(state.startTracking.mock.calls[0][2]).toEqual({ requestPermissions: false });
      expect(getLocationSession()).toMatchObject({ tripId: 41, sharing: true });
    });

    it("does not resume a trip that ended while the app was closed", async () => {
      save(41);
      state.trip.mockResolvedValue({ id: 41, status: "delivered" });
      await expect(resumeSharing()).resolves.toBe(false);
      expect(state.startTracking).not.toHaveBeenCalled();
      expect(saved(7)).toBeNull();
    });

    it("does not resume a trip that is no longer this driver's", async () => {
      save(41);
      state.trip.mockRejectedValue(Object.assign(new Error("That trip isn't assigned to you."), { status: 404 }));
      await expect(resumeSharing()).resolves.toBe(false);
      expect(state.startTracking).not.toHaveBeenCalled();
    });

    it("still resumes with no signal: the pings are saved and the server decides later", async () => {
      save(41);
      state.trip.mockRejectedValue(new Error("Failed to fetch"));
      await expect(resumeSharing()).resolves.toBe(true);
    });

    it("never picks up another driver's trip on a shared phone", async () => {
      save(41, 7);
      state.driverId = 8;
      await expect(resumeSharing()).resolves.toBe(false);
      expect(state.startTracking).not.toHaveBeenCalled();
      expect(saved(7)).toEqual({ tripId: 41 });
    });

    it("in a browser, resumes only when location is already allowed", async () => {
      state.background = false;
      save(41);
      permission("granted");
      await expect(resumeSharing()).resolves.toBe(true);
    });

    it("in a browser, stays off and says why when location was blocked — no prompt", async () => {
      state.background = false;
      save(41);
      permission("denied");
      await expect(resumeSharing()).resolves.toBe(false);
      expect(state.startTracking).not.toHaveBeenCalled();
      expect(getLocationSession()).toMatchObject({ tripId: 41, sharing: false, error: "permission off" });
      expect(saved(7)).toBeNull();
    });

    it("in a browser that would have to ask, waits for the driver to tap", async () => {
      state.background = false;
      save(41);
      permission("prompt");
      await expect(resumeSharing()).resolves.toBe(false);
      expect(state.startTracking).not.toHaveBeenCalled();
      expect(getLocationSession().error).toBe(RESUME_NEEDS_TAP);
    });

    it("in the app, stays off and says why when permission was taken away", async () => {
      save(41);
      state.startTracking.mockImplementation(async (_onFix, onError) => {
        onError("permission off", { fatal: true, canOpenSettings: true });
        return false;
      });
      await expect(resumeSharing()).resolves.toBe(false);
      expect(getLocationSession()).toMatchObject({ tripId: 41, sharing: false, error: "permission off", canOpenSettings: true });
      // not resumed again: what is kept is the reason, for the next open
      expect(saved(7)).toEqual({ tripId: 41, stopped: "permission off" });
    });

    it("tells the driver on the next open why sharing stopped while they were not looking", async () => {
      await startSharing(41);
      // permission taken away while the app was in the background
      state.onError("Location permission was refused.", { fatal: true, canOpenSettings: true });
      expect(getLocationSession().sharing).toBe(false);

      resetLocationSessionForTests(); // the app is closed and opened again
      await expect(resumeSharing()).resolves.toBe(false);
      expect(state.startTracking).toHaveBeenCalledTimes(1); // only the original start
      expect(getLocationSession()).toMatchObject({ tripId: 41, sharing: false, error: "Location permission was refused.", canOpenSettings: true });
      expect(saved(7)).toBeNull(); // said once
    });

    it("resumes once per app open, not on every screen that mounts", async () => {
      save(41);
      await resumeSharing();
      await resumeSharing();
      expect(state.startTracking).toHaveBeenCalledTimes(1);
    });
  });

  describe("ending by itself", () => {
    it("ends when the server says the trip can no longer be tracked (409)", async () => {
      state.ping.mockRejectedValue(Object.assign(new Error("Tracking is only active once the trip is released."), { status: 409 }));
      await startSharing(41);
      await state.onFix({ lat: 7.07, lng: 125.61 });
      await vi.waitFor(() => expect(getLocationSession().sharing).toBe(false));
      expect(state.stopTracking).toHaveBeenCalled();
      expect(saved(7)).toBeNull();
    });

    it("ends when dispatch closes the trip while the driver is elsewhere in the app", async () => {
      vi.useFakeTimers();
      await startSharing(41);
      state.trip.mockResolvedValue({ id: 41, status: "cancelled" });
      await vi.advanceTimersByTimeAsync(STATUS_CHECK_MS);
      expect(getLocationSession().sharing).toBe(false);
      expect(saved(7)).toBeNull();
    });

    it("keeps going through a GPS hiccup that is not fatal", async () => {
      await startSharing(41);
      state.onError("Lost your location for a moment — still trying.", { fatal: false });
      expect(getLocationSession()).toMatchObject({ sharing: true, error: "Lost your location for a moment — still trying." });
    });

    it("ignores callbacks from a session that was already stopped", async () => {
      await startSharing(41);
      const oldFix = state.onFix;
      stopSharing();
      await oldFix({ lat: 7.07, lng: 125.61 });
      expect(state.ping).not.toHaveBeenCalled();
      expect(getLocationSession().position).toBeNull();
    });
  });
});
