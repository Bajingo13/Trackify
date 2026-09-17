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

import { driverPing } from "./driverApi";

describe("driver road-work durability", () => {
  beforeEach(() => {
    state.online = false;
    state.enqueue.mockReset();
  });

  it("reports queued only after IndexedDB actually accepted the update", async () => {
    state.enqueue.mockResolvedValue(true);
    await expect(driverPing(41, { lat: 7.07, lng: 125.61 })).resolves.toEqual({ queued: true });
  });

  it("surfaces a storage failure instead of claiming the update was saved", async () => {
    state.enqueue.mockResolvedValue(false);
    await expect(driverPing(41, { lat: 7.07, lng: 125.61 }))
      .rejects.toThrow("Could not send or save this update on the phone");
  });
});
