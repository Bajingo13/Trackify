import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./native", () => ({ tap: () => {} }));
const { default: DriverTabBar } = await import("./DriverTabBar");

describe("driver tab bar", () => {
  it("shows new dispatch messages on Today, and says so to a screen reader", () => {
    render(<DriverTabBar active="history" onChange={() => {}} badges={{ trips: 2 }} />);
    expect(screen.getByRole("button", { name: "Today, 2 new messages" })).toHaveTextContent("2");
  });

  it("shows nothing when there is nothing new", () => {
    const { container } = render(<DriverTabBar active="trips" onChange={() => {}} badges={{ trips: 0 }} />);
    expect(container.querySelector(".dr-tab-badge")).toBeNull();
  });

  it("caps a large count", () => {
    render(<DriverTabBar active="history" onChange={() => {}} badges={{ trips: 14 }} />);
    expect(screen.getByRole("button", { name: /Today, 14 new messages/ })).toHaveTextContent("9+");
  });
});
