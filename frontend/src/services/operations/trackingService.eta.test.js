import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}));

vi.mock("../apiClient", () => api);

const { getActiveTripsWithTracking, getTripRoute } = await import("./trackingService");

describe("tracking ETA source data", () => {
  beforeEach(() => {
    api.get.mockReset();
  });

  it("maps schedule, actual timing and latest GPS fields used by the ETA", async () => {
    api.get.mockResolvedValueOnce({ data: [{
      trip_ticket_id: 7,
      route_distance_km: "120.5",
      route_duration_min: "180",
      scheduled_departure: "2026-11-11T01:00:00.000Z",
      scheduled_arrival: "2026-11-11T04:00:00.000Z",
      actual_departure: "2026-11-11T01:15:00.000Z",
      actual_arrival: null,
      latitude: "14.5",
      longitude: "121.0",
      last_update: "2026-11-11T02:00:00.000Z",
      gps_status: "online",
    }] });

    const [trip] = await getActiveTripsWithTracking();

    expect(trip).toMatchObject({
      id: 7,
      routeKm: 120.5,
      routeMin: 180,
      scheduledArrival: "2026-11-11T04:00:00.000Z",
      actualDeparture: "2026-11-11T01:15:00.000Z",
      actualArrival: null,
      tracking: {
        hasGps: true,
        lat: 14.5,
        lng: 121,
        gpsStatus: "online",
        lastGpsUpdate: "2026-11-11T02:00:00.000Z",
      },
    });
  });

  it("uses the existing cached route and tolerates serialized geometry", async () => {
    api.get.mockResolvedValueOnce({ data: {
      distanceKm: 10,
      durationMin: 20,
      geometry: JSON.stringify({ type: "LineString", coordinates: [[120, 14], [121, 14]] }),
    } });

    const route = await getTripRoute(7);

    expect(api.get).toHaveBeenCalledWith("/operations/trips/7/route");
    expect(route.geometry.type).toBe("LineString");
  });
});
