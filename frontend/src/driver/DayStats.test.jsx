import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./netStatus", () => import("./netStatus.mock"));

const { DayStats } = await import("./DriverApp");

const columns = (container) => container.querySelector(".dr-day-stats").style.gridTemplateColumns;

describe("Today's figures", () => {
  it("a run with no planned route shows one tile across the whole row, with no empty cell", () => {
    const { container } = render(<DayStats trips={[{ id: 1, status: "released" }]} current={{ id: 1, routeKm: null, routeMin: null }} />);
    expect(screen.getByText("Open run")).toBeInTheDocument();
    expect(screen.queryByText("Route")).toBeNull();
    expect(columns(container)).toBe("repeat(1, minmax(0, 1fr))");
  });

  it("a run with its route shows all three tiles in one row", () => {
    const { container } = render(
      <DayStats trips={[{ id: 1, status: "in_transit" }, { id: 2, status: "released" }]} current={{ id: 1, routeKm: 30.95, routeMin: 43 }} />
    );
    expect(screen.getByText("Open runs")).toBeInTheDocument();
    expect(screen.getByText("Route")).toBeInTheDocument();
    expect(screen.getByText("Est. drive")).toBeInTheDocument();
    expect(columns(container)).toBe("repeat(3, minmax(0, 1fr))");
  });
});
