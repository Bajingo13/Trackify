import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fmtDuration, fmtWhen, firstName, greeting, initials, LEG_ORDER, RouteTimeline, splitPlace, TripTrack } from "./DriverBits.jsx";

describe("driver identity helpers", () => {
  it("builds a compact badge from at most the first two names", () => {
    expect(initials("  Juan   Dela Cruz ")).toBe("JD");
    expect(initials("maria")).toBe("M");
    expect(initials()).toBe("");
  });

  it("takes the first given name for the greeting", () => {
    expect(firstName("  Paul Elisha Panhilason Rosal ")).toBe("Paul")
    expect(firstName("Ma. Theresa Santos")).toBe("Ma. Theresa")
    expect(firstName()).toBe("")
  })

  it("changes greeting at noon and 18:00", () => {
    expect(greeting(new Date(2026, 8, 14, 11, 59))).toBe("Good morning");
    expect(greeting(new Date(2026, 8, 14, 12, 0))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 8, 14, 18, 0))).toBe("Good evening");
  });
});

describe("TripTrack", () => {
  const cases = [
    ["assigned", ["now", "todo", "todo", "todo"]],
    ["released", ["done", "now", "todo", "todo"]],
    ["in_transit", ["done", "done", "now", "todo"]],
    ["delivered", ["done", "done", "done", "now"]],
    ["accepted", ["now", "todo", "todo", "todo"]],
  ];

  it("keeps the operational legs in their required order", () => {
    expect(LEG_ORDER).toEqual(["assigned", "released", "in_transit", "delivered"]);
  });

  it.each(cases)("maps %s to done, current, and remaining legs", (status, expected) => {
    const { container } = render(<TripTrack status={status} />);
    const states = [...container.querySelectorAll(".dr-track-step")].map(
      (step) => step.dataset.state,
    );

    expect(states).toEqual(expected);
  });
});

describe("what the run cards say about a trip", () => {
  it("writes a duration only when the route was computed", () => {
    expect(fmtDuration(43)).toBe("43 min");
    expect(fmtDuration(114)).toBe("1h 54m");
    expect(fmtDuration(125)).toBe("2h 05m");
    expect(fmtDuration(0)).toBeNull();
    expect(fmtDuration(null)).toBeNull();
    expect(fmtDuration(undefined)).toBeNull();
  });

  it("shows no time for a missing or unreadable date", () => {
    expect(fmtWhen(null)).toBeNull();
    expect(fmtWhen("not a date")).toBeNull();
    expect(fmtWhen("2026-08-29T10:00:00")).toMatch(/Aug/);
  });

  it("splits a qualified place name into the name and the rest", () => {
    expect(splitPlace("Balayan, Batangas, Calabarzon, 4213, Philippines")).toEqual({
      title: "Balayan",
      rest: "Batangas, Calabarzon, 4213, Philippines",
    });
    expect(splitPlace("Davao City")).toEqual({ title: "Davao City", rest: "" });
    expect(splitPlace("").title).toBe("—");
  });

  const base = { origin: "Davao City", destination: "Panabo City", scheduledDeparture: "2026-08-29T10:00:00", scheduledArrival: null, stops: [] };
  const states = (trip) => [...render(<RouteTimeline trip={trip} />).container.querySelectorAll(".dr-rt-pt")].map((p) => p.dataset.done);

  it("marks pickup done once the truck is on the road, and delivery only when delivered", () => {
    expect(states({ ...base, status: "released" })).toEqual(["no", "no"]);
    expect(states({ ...base, status: "in_transit" })).toEqual(["yes", "no"]);
    expect(states({ ...base, status: "delivered" })).toEqual(["yes", "yes"]);
  });

  it("shows a time only for a leg that has one, and counts stops in between on request", () => {
    const { container } = render(<RouteTimeline trip={{ ...base, status: "released", stops: [{ id: 1 }, { id: 2 }] }} withStops />);
    expect(container.querySelectorAll(".dr-rt-time")).toHaveLength(1);
    expect(container.textContent).toContain("2 stops in between");
  });
});
