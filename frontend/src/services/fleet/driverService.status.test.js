import { describe, expect, it, vi, beforeEach } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), del: vi.fn(), postForm: vi.fn(), getDataUrl: vi.fn() }));
vi.mock("../apiClient", () => api);

const { getAllDrivers, getDriverStats, isDriverAssignable, reactivateDriver } = await import("./driverService");

const row = (operational_status, over = {}) => ({
  driver_id: 1, first_name: "Juan", last_name: "Dela Cruz", license_no: "N01",
  status: operational_status === "inactive" ? "inactive" : "active", operational_status, ...over,
});

describe("a driver's status, as dispatch sees it", () => {
  beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); });

  it("a lapsed licence is shown as such, not as Available, and is not assignable", async () => {
    api.get.mockResolvedValue({ data: [row("licence_expired"), row("no_licence_expiry", { driver_id: 2 }), row("available", { driver_id: 3 })] });
    const { data } = await getAllDrivers();
    expect(data.map((d) => d.status)).toEqual(["Licence Expired", "No Licence Expiry", "Available"]);
    expect(data.map(isDriverAssignable)).toEqual([false, false, true]);
  });

  it("the Licence Expired filter finds them", async () => {
    api.get.mockResolvedValue({ data: [row("licence_expired"), row("available", { driver_id: 3 })] });
    const { data } = await getAllDrivers({ status: "Licence Expired" });
    expect(data.map((d) => d.id)).toEqual([1]);
  });

  it("stats carry the drivers grounded by their licence", async () => {
    api.get.mockResolvedValue({ data: { total: 5, available: 2, onTrip: 1, inactive: 1, licenceBlocked: 1, licence: { expired: 1, expiring: 0 } } });
    const s = await getDriverStats();
    expect(s.available).toBe(2);
    expect(s.licenceBlocked).toBe(1);
  });

  it("reactivating asks the server to make the driver active again", async () => {
    api.patch.mockResolvedValue({ success: true });
    expect(await reactivateDriver(7)).toEqual({ success: true });
    expect(api.patch).toHaveBeenCalledWith("/fleet/drivers/7", { status: "active" });
  });
});
