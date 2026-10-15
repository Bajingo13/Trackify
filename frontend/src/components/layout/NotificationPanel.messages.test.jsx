import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import NotificationPanel from "./NotificationPanel";

/*
 * A driver's message is a notification: it is listed in the bell, opens its
 * conversation, and the panel is never "all clear" while one is unread.
 */
const chats = [{ tripId: 32, ticketNo: "TT-2026-000032", unread: 2, lastMessage: { senderName: "Juan Dela Cruz", body: "At gate 3", createdAt: new Date().toISOString() } }];
const support = [{ id: 40, ticketNo: "SUP-000040", subject: "Flat tyre", driverName: "Ana Lim", tripNo: null, exceptionId: 88, unread: 1, preview: "Need a jack", lastAt: new Date().toISOString() }];

describe("drivers' messages in the console bell", () => {
  it("lists run chats and Help & Support requests with what was said", () => {
    render(<NotificationPanel alerts={[]} chats={chats} support={support} onOpen={vi.fn()} onDashboard={vi.fn()} />);
    expect(screen.getByText("3 unread messages")).toBeInTheDocument();
    expect(screen.getByText("Juan Dela Cruz · TT-2026-000032")).toBeInTheDocument();
    expect(screen.getByText("At gate 3")).toBeInTheDocument();
    expect(screen.getByText("Ana Lim · SUP-000040")).toBeInTheDocument();
    expect(screen.getByText("Flat tyre: Need a jack")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing needs attention/)).toBeNull();
  });

  it("opens the run with its chat, or the request's exception", () => {
    const onOpen = vi.fn();
    render(<NotificationPanel alerts={[]} chats={chats} support={support} onOpen={onOpen} onDashboard={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /TT-2026-000032/ }));
    expect(onOpen).toHaveBeenCalledWith("/operations/trips?trip=32&chat=1");
    fireEvent.click(screen.getByRole("button", { name: /SUP-000040/ }));
    expect(onOpen).toHaveBeenCalledWith("/operations/exceptions?exception=88");
  });

  it("is all clear only when there are no alerts and no unread messages", () => {
    render(<NotificationPanel alerts={[]} onOpen={vi.fn()} onDashboard={vi.fn()} />);
    expect(screen.getByText(/Nothing needs attention/)).toBeInTheDocument();
  });
});
