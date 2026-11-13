import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LiveEtaCard from "./LiveEtaCard";

const now = new Date("2026-11-11T02:00:00.000Z").getTime();
const trip = {
  status: "in_transit",
  routeKm: 100,
  routeMin: 120,
  actualDeparture: "2026-11-11T01:00:00.000Z",
  scheduledArrival: "2026-11-11T03:00:00.000Z",
};
const route = {
  distanceKm: 100,
  durationMin: 120,
  geometry: { type: "LineString", coordinates: [[120, 14], [121, 14]] },
};

describe("Live ETA card", () => {
  it("shows a simple live estimate with its limits", () => {
    render(<LiveEtaCard
      trip={trip}
      route={route}
      now={now}
      tracking={{ hasGps: true, gpsStatus: "online", lat: 14, lng: 120.5, lastGpsUpdate: "2026-11-11T01:58:00.000Z" }}
    />);
    const card = screen.getByRole("region", { name: "Estimated arrival" });
    expect(card).toHaveAttribute("data-kind", "live");
    expect(card).toHaveTextContent("Live operational estimate");
    expect(card).toHaveTextContent("About 50 km remaining");
    expect(card).toHaveTextContent("GPS updated 2 minutes ago");
    expect(card).toHaveTextContent("Route timing only · no live traffic");
  });

  it("warns clearly and uses the schedule when the GPS point is stale", () => {
    render(<LiveEtaCard
      trip={trip}
      route={route}
      now={now}
      tracking={{ hasGps: true, gpsStatus: "offline", lat: 14, lng: 120.5, lastGpsUpdate: "2026-11-11T01:40:00.000Z" }}
    />);
    const card = screen.getByRole("region", { name: "Estimated arrival" });
    expect(card).toHaveAttribute("data-kind", "stale");
    expect(card).toHaveTextContent("Scheduled estimate");
    expect(card).toHaveTextContent("GPS signal is delayed");
    expect(card).toHaveTextContent("GPS updated 20 minutes ago");
  });
});
