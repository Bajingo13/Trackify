import { describe, expect, it, vi } from "vitest";
import { licenceExpiry, licenceDaysLeft, LICENCE_WARNING_DAYS } from "./licenceExpiry";
import { getLicenseExpiryStatus } from "./driverService";
import { validateAssignment } from "../operations/dispatchService";

vi.mock("../apiClient", () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), postForm: vi.fn(), getDataUrl: vi.fn() }));

/* A fixed afternoon, local time, so "today" is unambiguous whatever machine runs this. */
const NOW = new Date(2026, 9, 15, 14, 30);
const on = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

describe("where a licence stands, on the office's calendar", () => {
  it("counts whole calendar days, not hours", () => {
    expect(licenceDaysLeft("2026-10-15", NOW)).toBe(0);
    expect(licenceDaysLeft("2026-10-16", NOW)).toBe(1);
    expect(licenceDaysLeft("2026-10-14", NOW)).toBe(-1);
    // an hour either side of midnight makes no difference
    expect(licenceDaysLeft("2026-10-16", new Date(2026, 9, 15, 0, 5))).toBe(1);
    expect(licenceDaysLeft("2026-10-16", new Date(2026, 9, 15, 23, 55))).toBe(1);
  });

  it("is good THROUGH the expiry date — it is not expired on the day it expires", () => {
    expect(licenceExpiry("2026-10-15", NOW)).toMatchObject({ state: "expiring", label: "Expiring Soon", text: "Expires today" });
    expect(licenceExpiry("2026-10-14", NOW)).toMatchObject({ state: "expired", label: "Expired" });
  });

  it("uses the same 60-day window as the server, the app and the reminders", () => {
    expect(LICENCE_WARNING_DAYS).toBe(60);
    expect(licenceExpiry("2026-12-14", NOW).state).toBe("expiring"); // day 60
    expect(licenceExpiry("2026-12-15", NOW).state).toBe("valid"); // day 61
  });

  it("words the time left", () => {
    expect(licenceExpiry("2026-10-16", NOW).text).toBe("Expires tomorrow");
    expect(licenceExpiry("2026-10-27", NOW).text).toBe("Expires in 12 days");
    expect(licenceExpiry("2026-10-14", NOW).text).toBe("Expired yesterday");
    expect(licenceExpiry("2026-10-12", NOW).text).toBe("Expired 3 days ago");
    expect(licenceExpiry("2027-10-15", NOW).text).toBe("Valid for 365 more days");
  });

  it("treats a missing or unreadable date as a gap, not a lapse", () => {
    for (const bad of [null, undefined, "", "soon", "15/10/2026"]) {
      expect(licenceExpiry(bad, NOW)).toMatchObject({ state: "none", days: null, label: "Valid", text: "No expiry recorded" });
    }
  });

  it("accepts a timestamp as well as a plain date", () => {
    expect(licenceExpiry("2026-10-27T00:00:00.000Z", NOW).state).toBe("expiring");
  });

  it("keeps the names the driver list filters on", () => {
    expect(getLicenseExpiryStatus(on(2026, 1, 1))).toBe("Expired");
    expect(getLicenseExpiryStatus(on(2099, 1, 1))).toBe("Valid");
    expect(getLicenseExpiryStatus(null)).toBe("Valid");
    const soon = new Date(Date.now() + 10 * 86_400_000);
    expect(getLicenseExpiryStatus(on(soon.getFullYear(), soon.getMonth() + 1, soon.getDate()))).toBe("Expiring Soon");
  });
});

describe("the dispatch pre-check agrees with the server about the licence", () => {
  const trip = { id: 1 };
  const vehicle = null;
  const check = (licenseExpiry, v = vehicle) =>
    validateAssignment(trip, { id: 1, licenseExpiry }, v).checks.find((c) => c.label.startsWith("Licence"));
  const offset = (days) => {
    const d = new Date(Date.now() + days * 86_400_000);
    return on(d.getFullYear(), d.getMonth() + 1, d.getDate());
  };

  it("lets a licence that expires today through, with a warning", () => {
    // The server refuses only once the date has passed (license_expiry >= today).
    // The old pre-check called today "expired" and blocked a trip the server would accept.
    const c = check(offset(0));
    expect(c.state).toBe("warn");
    expect(c.message).toMatch(/Expiring/);
  });

  it("blocks one that has expired", () => {
    expect(check(offset(-1)).state).toBe("fail");
  });

  it("warns inside the 60-day window and passes outside it", () => {
    expect(check(offset(45)).state).toBe("warn");
    expect(check(offset(90)).state).toBe("pass");
  });

  it("warns when no expiry is on file", () => {
    expect(check(null).state).toBe("warn");
  });

  it("still checks the vehicle's registration once a vehicle is chosen", () => {
    // the licence check and the registration check share the clock; changing one
    // must not break the other
    const result = validateAssignment(trip, { id: 1, licenseExpiry: offset(200) }, { id: 2, registrationExpiry: offset(-3), capacity: 1000 });
    expect(result.checks.find((c) => c.label === "Registration valid").state).toBe("fail");
    expect(result.ready).toBe(false);
    const fine = validateAssignment(trip, { id: 1, licenseExpiry: offset(200) }, { id: 2, registrationExpiry: offset(200), capacity: 1000 });
    expect(fine.checks.find((c) => c.label === "Registration valid").state).toBe("pass");
  });
});
