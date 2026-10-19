import { describe, expect, it } from "vitest";
import { drivenLine, isDone, spansDays } from "./drivenTrail";

describe("the route driven", () => {
  it("counts a run as done from delivery on", () => {
    expect(["delivered", "returned", "operationally_closed"].every(isDone)).toBe(true);
    expect(["assigned", "released", "in_transit", "cancelled"].some(isDone)).toBe(false);
  });

  it("draws the snapped line when there is one, else joins the raw fixes", () => {
    const snapped = { type: "LineString", coordinates: [[1, 2], [3, 4]] };
    expect(drivenLine({ snapped, points: [] })).toBe(snapped);
    expect(drivenLine({ snapped: null, points: [{ lat: 2, lng: 1 }, { lat: 4, lng: 3 }] }))
      .toEqual({ type: "LineString", coordinates: [[1, 2], [3, 4]] });
  });

  it("has nothing to draw from fewer than two fixes", () => {
    expect(drivenLine(null)).toBeNull();
    expect(drivenLine({ snapped: null, points: [{ lat: 2, lng: 1 }] })).toBeNull();
    expect(drivenLine({ snapped: { type: "LineString", coordinates: [[1, 2]] }, points: [] })).toBeNull();
  });

  it("knows when a run ran past midnight", () => {
    expect(spansDays("2026-08-29T10:00:00", "2026-08-29T13:00:00")).toBe(false);
    expect(spansDays("2026-08-29T22:00:00", "2026-08-30T01:00:00")).toBe(true);
  });
});
