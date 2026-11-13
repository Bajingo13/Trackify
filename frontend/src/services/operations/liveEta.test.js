import { describe, expect, it } from "vitest";
import { estimateLiveEta, formatGpsAge, progressOnRoute } from "./liveEta";

const route = {
  distanceKm: 100,
  durationMin: 120,
  geometry: { type: "LineString", coordinates: [[120, 14], [121, 14]] },
};
const now = new Date("2026-11-11T02:00:00.000Z").getTime();
const trip = {
  status: "in_transit",
  routeKm: 100,
  routeMin: 120,
  actualDeparture: "2026-11-11T01:00:00.000Z",
  scheduledArrival: "2026-11-11T03:00:00.000Z",
};

describe("free operational ETA", () => {
  it("measures progress against cached route geometry without an external request", () => {
    const result = progressOnRoute(route.geometry, 14, 120.5);
    expect(result.progress).toBeCloseTo(0.5, 2);
    expect(progressOnRoute(route.geometry, 30, 120.5)).toBeNull();
  });

  it("uses fresh GPS progress and clearly remains non-traffic-aware", () => {
    const eta = estimateLiveEta({
      trip,
      route,
      now,
      tracking: { hasGps: true, gpsStatus: "online", lat: 14, lng: 120.5, lastGpsUpdate: "2026-11-11T01:58:00.000Z" },
    });
    expect(eta.kind).toBe("live");
    expect(eta.progress).toBeCloseTo(0.5, 2);
    expect(eta.distanceRemainingKm).toBeCloseTo(50, 1);
    expect(eta.trafficAware).toBe(false);
    expect(eta.notice).toMatch(/traffic is not included/i);
  });

  it("falls back to the schedule when GPS is stale", () => {
    const eta = estimateLiveEta({
      trip,
      route,
      now,
      tracking: { hasGps: true, gpsStatus: "offline", lat: 14, lng: 120.5, lastGpsUpdate: "2026-11-11T01:40:00.000Z" },
    });
    expect(eta.kind).toBe("stale");
    expect(eta.label).toBe("Scheduled estimate");
    expect(eta.notice).toMatch(/signal is delayed/i);
  });

  it("uses a scheduled fallback when there is no GPS and explains a pause", () => {
    expect(estimateLiveEta({ trip, route, now, tracking: null })).toMatchObject({
      kind: "no-gps",
      label: "Scheduled estimate",
    });
    expect(estimateLiveEta({ trip: { ...trip, pause: { status: "approved" } }, route, now, tracking: null })).toMatchObject({
      kind: "paused",
      notice: expect.stringMatching(/paused/i),
    });
  });

  it("does not call an off-route point live and reports an actual arrival when finished", () => {
    const offRoute = estimateLiveEta({
      trip,
      route,
      now,
      tracking: { hasGps: true, gpsStatus: "online", lat: 30, lng: 120.5, lastGpsUpdate: "2026-11-11T01:59:00.000Z" },
    });
    expect(offRoute.kind).toBe("unmatched");
    const arrived = estimateLiveEta({
      trip: { ...trip, status: "delivered", actualArrival: "2026-11-11T02:10:00.000Z" },
      route,
      now,
      tracking: null,
    });
    expect(arrived).toMatchObject({ kind: "arrived", label: "Arrived" });
  });

  it("formats GPS age in plain language", () => {
    expect(formatGpsAge(20_000)).toBe("just now");
    expect(formatGpsAge(120_000)).toBe("2 minutes ago");
    expect(formatGpsAge(115 * 60 * 60_000)).toBe("4 days ago");
  });
});
