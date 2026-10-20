import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NotificationPanel from "./NotificationPanel";

const alerts = [
  { id: "low-1", kind: "inventory", severity: "critical", title: "Diesel out of stock", description: "Davao depot — 0 L on hand (reorder at 500)", tag: "Inventory", href: "/warehouse/inventory" },
  { id: "exc-4", kind: "exception", severity: "warning", title: "Late delivery", description: "DVO-2026-0011 — ETA missed", tag: "Operations", href: "/operations/exceptions" },
];
const phone = {
  id: "dev-7", kind: "device", severity: "warning", title: "Juan Dela Cruz is waiting for a new phone to be approved",
  tag: "Drivers", href: "/fleet/drivers?driver=12", driverId: 12, driverName: "Juan Dela Cruz", employeeNo: "DRV-0012",
  askedAt: new Date().toISOString(), locked: false,
};
const chats = [{ tripId: 32, ticketNo: "TT-2026-000032", unread: 2, lastMessage: { senderName: "Ana Lim", body: "At gate 3", createdAt: new Date().toISOString() } }];

describe("the notifications list", () => {
  it("counts what needs attention, and lists each item with its kind", () => {
    render(<NotificationPanel alerts={alerts} onOpen={() => {}} onDashboard={() => {}} />);
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("2 new")).toHaveAttribute("data-tone", "critical"); // one is critical
    const row = screen.getByRole("button", { name: /Diesel out of stock/ });
    expect(row).toHaveTextContent("Davao depot");
    expect(row).toHaveTextContent("Inventory");
    expect(screen.getByRole("button", { name: /Late delivery/ })).toHaveAttribute("data-tone", "warning");
  });

  it("is amber, not red, when nothing is critical", () => {
    render(<NotificationPanel alerts={[alerts[1]]} onOpen={() => {}} onDashboard={() => {}} />);
    expect(screen.getByText("1 new")).toHaveAttribute("data-tone", "warning");
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
    expect(screen.queryByText(/ new$/)).toBeNull();
    rerender(<NotificationPanel alerts={[]} onOpen={() => {}} onDashboard={() => {}} />);
    expect(screen.getByText("Nothing needs attention right now.")).toBeInTheDocument();
  });
});

describe("notification categories", () => {
  it("has a tab per category, each with its count", () => {
    render(<NotificationPanel alerts={[...alerts, phone]} chats={chats} onOpen={() => {}} onDashboard={() => {}} />);
    expect(screen.getByRole("tab", { name: /All\s*5/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Phone codes\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Messages\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Alerts\s*2/ })).toBeInTheDocument();
  });

  it("puts what drivers are waiting on first, in its own section, above other alerts", () => {
    render(<NotificationPanel alerts={[...alerts, phone]} chats={chats} onOpen={() => {}} onDashboard={() => {}} />);
    const drivers = screen.getByRole("region", { name: "From drivers" });
    expect(within(drivers).getByRole("button", { name: /Juan Dela Cruz · DRV-0012/ })).toHaveTextContent("Code request");
    expect(within(drivers).getByRole("button", { name: /TT-2026-000032/ })).toBeInTheDocument();
    expect(within(drivers).queryByRole("button", { name: /Diesel/ })).toBeNull();
    const rows = screen.getAllByRole("button").map((b) => b.textContent);
    expect(rows.findIndex((t) => t.includes("DRV-0012"))).toBeLessThan(rows.findIndex((t) => t.includes("Diesel")));
  });

  it("shows only one category on its tab", () => {
    render(<NotificationPanel alerts={[...alerts, phone]} chats={chats} onOpen={() => {}} onDashboard={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /Phone codes/ }));
    expect(screen.getByRole("button", { name: /DRV-0012/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Diesel/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /TT-2026-000032/ })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /Alerts/ }));
    expect(screen.getByRole("button", { name: /Diesel/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /DRV-0012/ })).toBeNull();
  });

  it("opens the driver's phones from a code request, and says when a driver is locked out", () => {
    const onOpen = vi.fn();
    render(<NotificationPanel alerts={[{ ...phone, locked: true, severity: "critical" }]} onOpen={onOpen} onDashboard={() => {}} tab="codes" />);
    const row = screen.getByRole("button", { name: /DRV-0012/ });
    expect(row).toHaveTextContent("Locked");
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith("/fleet/drivers?driver=12");
  });

  it("can be turned to a tab from outside", () => {
    const onTab = vi.fn();
    render(<NotificationPanel alerts={[]} onOpen={() => {}} onDashboard={() => {}} tab="codes" onTab={onTab} />);
    expect(screen.getByText("No driver is waiting for a phone to be approved.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Messages/ }));
    expect(onTab).toHaveBeenCalledWith("messages");
  });
});
