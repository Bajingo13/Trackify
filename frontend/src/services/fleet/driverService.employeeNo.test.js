import { describe, expect, it, vi, beforeEach } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), del: vi.fn(), postForm: vi.fn(), getDataUrl: vi.fn() }));
vi.mock("../apiClient", () => api);

const { createDriver, updateDriver } = await import("./driverService");

/*
 * Employee Numbers are assigned by the server. The client must never send one —
 * not when registering (it would be ignored, but sending it suggests it counts),
 * and not when editing (the server refuses a changed number outright).
 */
describe("Employee Numbers are never sent from the office screens", () => {
  beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); });

  const driver = { employeeNo: "DRV-007", firstName: "Juan", lastName: "Dela Cruz", contactNo: "0917", licenseNo: "N01", licenseType: "Professional", licenseExpiry: "2030-01-01", emergencyContact: {} };

  it("an edit does not include it", async () => {
    await updateDriver(7, driver);
    const [, body] = api.patch.mock.calls[0];
    expect(body).not.toHaveProperty("employeeNo");
    expect(body.firstName).toBe("Juan");
  });

  it("a registration does not include it, and hands back the one the server assigned", async () => {
    api.postForm.mockResolvedValue({ success: true, data: { driverId: 42, employeeNo: "DRV-012" } });
    const res = await createDriver({ ...driver, pin: "4821", licenseReviewed: true }, new File(["x"], "l.jpg", { type: "image/jpeg" }));
    const form = api.postForm.mock.calls[0][1];
    expect(form.has("employeeNo")).toBe(false);
    expect(form.get("pin")).toBe("4821");
    expect(res.data.employeeNo).toBe("DRV-012");
  });
});
