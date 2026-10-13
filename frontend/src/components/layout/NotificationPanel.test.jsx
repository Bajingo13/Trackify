import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NotificationPanel from "./NotificationPanel";

const alerts = [
  { id: "low-1", kind: "inventory", severity: "critical", title: "Diesel out of stock", description: "Davao depot — 0 L on hand (reorder at 500)", tag: "Inventory", href: "/warehouse/inventory" },
  { id: "exc-4", kind: "exception", severity: "warning", title: "Late delivery", description: "DVO-2026-0011 — ETA missed", tag: "Operations", href: "/operations/exceptions" },
];

describe("the notifications list", () => {
  it("counts what needs attention, and lists each item with its kind", () => {
    render(<NotificationPanel alerts={alerts} onOpen={() => {}} onDashboard={() => {}} />);
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("2 need attention")).toHaveAttribute("data-tone", "critical"); // one is critical
    const row = screen.getByRole("button", { name: /Diesel out of stock/ });
    expect(row).toHaveTextContent("Davao depot");
    expect(row).toHaveTextContent("Inventory");
    expect(screen.getByRole("button", { name: /Late delivery/ })).toHaveAttribute("data-tone", "warning");
  });

  it("is amber, not red, when nothing is critical", () => {
    render(<NotificationPanel alerts={[alerts[1]]} onOpen={() => {}} onDashboard={() => {}} />);
    expect(screen.getByText("1 need attention")).toHaveAttribute("data-tone", "warning");
  });

  it("opens the page an item belongs to, and the dashboard from the footer", () => {
    const onOpen = vi.fn();
    const onDashboard = vi.fn();
    render(<NotificationPanel alerts={alerts} onOpen={onOpen} onDashboard={onDashboard} />);
    fireEvent.click(screen.getByRole("button", { name: /Late delivery/ }));
    expect(onOpen).toHaveBeenCalledWith("/operations/exceptions");
    fireEvent.click(screen.getByRole("button", { name: /Open dashboard/ }));
    expect(onDashboard).toHaveBeenCalled();
  });

  it("says when it is loading and when there is nothing to do", () => {
    const { rerender } = render(<NotificationPanel alerts={null} onOpen={() => {}} onDashboard={() => {}} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText(/need attention/)).toBeNull();
    rerender(<NotificationPanel alerts={[]} onOpen={() => {}} onDashboard={() => {}} />);
    expect(screen.getByText("Nothing needs attention right now.")).toBeInTheDocument();
    expect(screen.queryByText(/need attention$/)).toBeNull();
  });
});
