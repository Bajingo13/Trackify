import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  describe("when the licence is running out", () => {
    const expiring = { expiry: "2026-11-01", daysLeft: 17, state: "expiring" };
    const expired = { expiry: "2026-10-01", daysLeft: -14, state: "expired" };

    it("counts it on the bell, with any messages", () => {
      render(<DriverBell rows={rows} licence={expiring} />);
      expect(screen.getByRole("button", { name: "Notifications, 4 new" })).toBeInTheDocument();
    });

    it("is a notification on its own, even with no messages", () => {
      render(<DriverBell rows={[]} licence={expired} />);
      expect(screen.getByRole("button", { name: "Notifications, 1 new" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
      expect(screen.getByText("Your licence has expired")).toBeInTheDocument();
      expect(screen.queryByText(/all caught up/i)).toBeNull();
    });

    it("says how long is left and opens the licence when tapped", () => {
      const onOpenLicence = vi.fn();
      render(<DriverBell rows={[]} licence={expiring} onOpenLicence={onOpenLicence} />);
      fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
      expect(screen.getByText("Your licence expires in 17 days")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Your licence expires in 17 days/ }));
      expect(onOpenLicence).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Your licence expires in 17 days")).toBeNull();
    });

    it("is silent about a licence that is fine, or not recorded", () => {
      render(<DriverBell rows={[]} licence={{ expiry: "2030-01-01", daysLeft: 1200, state: "valid" }} />);
      expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
      cleanup();
      render(<DriverBell rows={[]} licence={{ state: "none", daysLeft: null }} />);
      expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    });
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
