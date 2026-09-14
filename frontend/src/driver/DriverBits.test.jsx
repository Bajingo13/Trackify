import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { greeting, initials, LEG_ORDER, TripTrack } from "./DriverBits.jsx";

describe("driver identity helpers", () => {
  it("builds a compact badge from at most the first two names", () => {
    expect(initials("  Juan   Dela Cruz ")).toBe("JD");
    expect(initials("maria")).toBe("M");
    expect(initials()).toBe("");
  });

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
