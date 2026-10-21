import { describe, expect, it } from "vitest";
import { cachedTrip, cachedTrips, clearTripCache, saveTrip, saveTrips, savedAtLabel } from "./tripCache";

describe("trips kept on the phone for driving offline", () => {
  it("returns the trip last saved, with when it was saved", async () => {
    await saveTrip(7, { id: 31, ticketNo: "TT-31", routeGeom: { type: "LineString", coordinates: [[125.6, 7.07]] } });
    const kept = await cachedTrip(7, 31);
    expect(kept.data.ticketNo).toBe("TT-31");
    expect(kept.data.routeGeom.coordinates).toHaveLength(1);
    expect(typeof kept.savedAt).toBe("number");
  });

  it("keeps one driver's trips apart from another's, and forgets them on sign-out", async () => {
    await saveTrips(7, [{ id: 31 }]);
    await saveTrips(8, [{ id: 40 }]);
    await saveTrip(7, { id: 31 });
    expect((await cachedTrips(8)).data).toEqual([{ id: 40 }]);

    await clearTripCache(7);
    expect(await cachedTrips(7)).toBeNull();
    expect(await cachedTrip(7, 31)).toBeNull();
    expect((await cachedTrips(8)).data).toEqual([{ id: 40 }]);
  });

  it("keeps nothing without a signed-in driver", async () => {
    await saveTrip(null, { id: 1 });
    expect(await cachedTrip(null, 1)).toBeNull();
  });

  it("labels a copy from today by its time alone", () => {
    const now = new Date(2026, 9, 21, 15, 0);
    expect(savedAtLabel(new Date(2026, 9, 21, 9, 42).getTime(), now)).not.toMatch(/Oct/);
    expect(savedAtLabel(new Date(2026, 9, 20, 9, 42).getTime(), now)).toMatch(/Oct/);
  });
});
