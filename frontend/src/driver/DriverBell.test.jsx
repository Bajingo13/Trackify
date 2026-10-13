import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./native", () => ({ tap: () => {} }));

const { default: DriverBell } = await import("./DriverBell");

const rows = [
  { tripId: 15, ticketNo: "DVO-2026-0015", unread: 2 },
  { tripId: 12, ticketNo: "DVO-2026-0012", unread: 1 },
];

describe("the notification bell", () => {
  it("counts unread messages from dispatch on the bell", () => {
    render(<DriverBell rows={rows} />);
    expect(screen.getByRole("button", { name: "Notifications, 3 new" })).toBeInTheDocument();
  });

  it("is plain when there is nothing new, and says so when opened", () => {
    render(<DriverBell rows={[]} />);
    const bell = screen.getByRole("button", { name: "Notifications" });
    fireEvent.click(bell);
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it("lists each trip with new messages and opens the one that is tapped", () => {
    const onOpenTrip = vi.fn();
    render(<DriverBell rows={rows} onOpenTrip={onOpenTrip} />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(screen.getByText("2 new messages from dispatch")).toBeInTheDocument();
    expect(screen.getByText("1 new message from dispatch")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /DVO-2026-0012/ }));
    expect(onOpenTrip).toHaveBeenCalledWith(12);
    // and the panel closes behind it
    expect(screen.queryByText("1 new message from dispatch")).toBeNull();
  });

  it("closes on Escape and on a tap elsewhere", () => {
    render(<DriverBell rows={rows} />);
    const bell = screen.getByRole("button", { name: /Notifications/ });
    fireEvent.click(bell);
    expect(bell).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(bell).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(bell);
    fireEvent.pointerDown(document.body);
    expect(bell).toHaveAttribute("aria-expanded", "false");
  });
});
