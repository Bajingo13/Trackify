import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [], allowed: true, realtime: null, calls: 0, chatOpen: null }));

vi.mock("../../services/operations/chatService", () => ({
  CHAT_READ_EVENT: "trackify:chat-read",
  getUnread: () => { state.calls += 1; return Promise.resolve(state.rows); },
  isChatOpen: (id) => state.chatOpen === id,
}));
vi.mock("../../auth/permissions", () => ({ usePermissions: () => ({ can: () => state.allowed }) }));
vi.mock("../../services/realtime", () => ({ useRealtime: (h) => { state.realtime = h; } }));

const { default: ChatInbox, ago } = await import("./ChatInbox");

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
}
const renderAt = () => render(
  <MemoryRouter initialEntries={["/finance/invoices"]}>
    <ChatInbox />
    <Routes><Route path="*" element={<Where />} /></Routes>
  </MemoryRouter>
);

describe("top-bar driver messages", () => {
  beforeEach(() => {
    state.rows = [{ tripId: 15, ticketNo: "DVO-2026-0015", unread: 2 }, { tripId: 12, ticketNo: "DVO-2026-0012", unread: 1 }];
    state.allowed = true;
    state.calls = 0;
    state.chatOpen = null;
  });

  it("counts unread driver messages across trips, from any page", async () => {
    renderAt();
    expect(await screen.findByRole("button", { name: "Driver messages (3 unread)" })).toBeInTheDocument();
  });

  it("lists each conversation with what was said and when, under a total", async () => {
    const now = Date.now();
    state.rows = [
      { tripId: 15, ticketNo: "DVO-2026-0015", unread: 2, lastMessage: { body: "Arrived at delivery location.", createdAt: new Date(now - 5 * 60000).toISOString(), hasPhoto: false } },
      { tripId: 12, ticketNo: "DVO-2026-0012", unread: 1, lastMessage: { body: "", createdAt: new Date(now - 3 * 3600000).toISOString(), hasPhoto: true } },
      { tripId: 9, ticketNo: "DVO-2026-0009", unread: 1, lastMessage: null },
    ];
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: /Driver messages/ }));

    expect(screen.getByText("Messages from drivers")).toBeInTheDocument();
    expect(screen.getByText("4 new")).toBeInTheDocument(); // the header total

    const first = screen.getByRole("button", { name: /DVO-2026-0015/ });
    expect(first).toHaveTextContent("Arrived at delivery location.");
    expect(first).toHaveTextContent("5 min ago");
    expect(first).toHaveTextContent("2 new");

    // a picture with no words says so, and a row with no message still says something
    expect(screen.getByRole("button", { name: /DVO-2026-0012/ })).toHaveTextContent("Sent a photo");
    expect(screen.getByRole("button", { name: /DVO-2026-0012/ })).toHaveTextContent("3 hours ago");
    expect(screen.getByRole("button", { name: /DVO-2026-0009/ })).toHaveTextContent("New message");
  });

  it("goes to the trips page from the footer", async () => {
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: /Driver messages/ }));
    fireEvent.click(screen.getByRole("button", { name: /Go to trips/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/operations/trips");
  });

  it("opens the trip with its conversation showing", async () => {
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: /Driver messages/ }));
    fireEvent.click(screen.getByRole("button", { name: /DVO-2026-0012/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/operations/trips?trip=12&chat=1");
  });

  it("re-counts when a driver writes, and when a conversation is read anywhere", async () => {
    renderAt();
    await screen.findByRole("button", { name: "Driver messages (3 unread)" });
    const before = state.calls;

    state.rows = [{ tripId: 15, ticketNo: "DVO-2026-0015", unread: 3 }, { tripId: 12, ticketNo: "DVO-2026-0012", unread: 1 }];
    act(() => state.realtime({ type: "trip:message", tripId: 15, message: { senderKind: "driver" } }));
    expect(await screen.findByRole("button", { name: "Driver messages (4 unread)" })).toBeInTheDocument();

    state.rows = [];
    act(() => { window.dispatchEvent(new Event("trackify:chat-read")); });
    expect(await screen.findByRole("button", { name: "Driver messages" })).toBeInTheDocument();
    expect(state.calls).toBeGreaterThanOrEqual(before + 2);
  });

  it("ignores its own side's messages", async () => {
    renderAt();
    await screen.findByRole("button", { name: "Driver messages (3 unread)" });
    const before = state.calls;
    act(() => state.realtime({ type: "trip:message", tripId: 15, message: { senderKind: "staff" } }));
    await waitFor(() => expect(state.calls).toBe(before));
  });

  it("pops up when a driver writes, naming the driver and the trip, and opens the conversation on a click", async () => {
    renderAt();
    await screen.findByRole("button", { name: "Driver messages (3 unread)" });
    act(() => state.realtime({
      type: "trip:message", tripId: 15,
      message: { senderKind: "driver", senderName: "Juan Dela Cruz", body: "Nasa gate na po." },
    }));

    const popup = await screen.findByRole("button", { name: /Juan Dela Cruz/ });
    expect(popup).toHaveTextContent("DVO-2026-0015");
    expect(popup).toHaveTextContent("Nasa gate na po.");

    fireEvent.click(popup);
    expect(screen.getByTestId("where")).toHaveTextContent("/operations/trips?trip=15&chat=1");
    // It leaves with a short exit animation.
    await waitFor(() => expect(screen.queryByRole("button", { name: /Juan Dela Cruz/ })).toBeNull());
  });

  it("says a photo arrived when the message is only a picture", async () => {
    renderAt();
    await screen.findByRole("button", { name: "Driver messages (3 unread)" });
    act(() => state.realtime({
      type: "trip:message", tripId: 12,
      message: { senderKind: "driver", senderName: "Juan Dela Cruz", body: "", hasPhoto: true },
    }));
    expect(await screen.findByText("Sent a photo")).toBeInTheDocument();
  });

  it("does not pop up for the conversation that is already open, nor for dispatch's own messages", async () => {
    renderAt();
    await screen.findByRole("button", { name: "Driver messages (3 unread)" });
    state.chatOpen = 15;
    act(() => state.realtime({ type: "trip:message", tripId: 15, message: { senderKind: "driver", senderName: "Juan", body: "hi" } }));
    act(() => state.realtime({ type: "trip:message", tripId: 12, message: { senderKind: "staff", senderName: "Ana", body: "ok" } }));
    await waitFor(() => expect(state.calls).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText("hi")).toBeNull();
    expect(screen.queryByText("ok")).toBeNull();
  });

  it("shows one notice per trip, the latest message", async () => {
    renderAt();
    await screen.findByRole("button", { name: "Driver messages (3 unread)" });
    const say = (body) => act(() => state.realtime({ type: "trip:message", tripId: 15, message: { senderKind: "driver", senderName: "Juan", body } }));
    say("una");
    await screen.findByText("una");
    say("pangalawa");
    expect(await screen.findByText("pangalawa")).toBeInTheDocument();
    expect(screen.queryByText("una")).toBeNull();
  });

  it("is not shown to someone who may not read driver messages", () => {
    state.allowed = false;
    renderAt();
    expect(screen.queryByRole("button", { name: /Driver messages/ })).toBeNull();
    expect(state.calls).toBe(0);
  });
});

describe("how long ago", () => {
  const now = new Date("2026-10-13T12:00:00").getTime();
  const at = (ms) => new Date(now - ms).toISOString();
  it("reads in the words a dispatcher would use", () => {
    expect(ago(at(20 * 1000), now)).toBe("Just now");
    expect(ago(at(5 * 60000), now)).toBe("5 min ago");
    expect(ago(at(60 * 60000), now)).toBe("1 hour ago");
    expect(ago(at(2 * 3600000 + 5000), now)).toBe("2 hours ago");
    expect(ago(at(30 * 3600000), now)).toBe("Yesterday");
    expect(ago(at(5 * 86400000), now)).toMatch(/Oct/);
  });
  it("shows nothing for a time that is missing or not a time", () => {
    expect(ago(undefined, now)).toBe("");
    expect(ago("nonsense", now)).toBe("");
  });
});
