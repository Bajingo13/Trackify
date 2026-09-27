import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  thread: { messages: [], closed: false },
  send: vi.fn(),
  read: vi.fn(),
  outbox: [],
}));

vi.mock("./driverApi", () => ({
  currentDriverId: () => 7,
  driverMessages: () => Promise.resolve(state.thread),
  driverSendMessage: (...args) => state.send(...args),
  driverMarkRead: (...args) => { state.read(...args); return Promise.resolve(); },
}));
vi.mock("./offlineQueue", () => ({
  pending: () => Promise.resolve(state.outbox),
  onQueueChange: () => () => {},
}));
vi.mock("./native", () => ({ tap: () => {} }));

const { default: DriverChat } = await import("./DriverChat");

const msg = (id, body, mine, extra = {}) => ({
  id, tripId: 15, senderKind: mine ? "driver" : "staff", senderName: mine ? "Jose Garcia" : "Ana Dispatcher",
  body, clientRef: null, createdAt: new Date().toISOString(), mine, ...extra,
});

describe("driver chat with dispatch", () => {
  beforeEach(() => {
    state.thread = { messages: [msg(1, "Saan ka na?", false)], closed: false };
    state.send.mockReset();
    state.read.mockReset();
    state.outbox = [];
  });

  it("shows the conversation and marks it read", async () => {
    render(<DriverChat tripId={15} ticketNo="TT-0015" onClose={() => {}} />);
    expect(await screen.findByText("Saan ka na?")).toBeInTheDocument();
    expect(screen.getByText("Ana Dispatcher")).toBeInTheDocument();
    await waitFor(() => expect(state.read).toHaveBeenCalledWith(15, 1));
  });

  it("sends a quick reply in one tap, with an id that makes a replay harmless", async () => {
    state.send.mockResolvedValue({ data: msg(2, "Nasa gate na po.", true) });
    render(<DriverChat tripId={15} ticketNo="TT-0015" onClose={() => {}} />);
    await screen.findByText("Saan ka na?");

    fireEvent.click(screen.getByRole("button", { name: "Nasa gate na po." }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    const [tripId, body, clientRef] = state.send.mock.calls[0];
    expect(tripId).toBe(15);
    expect(body).toBe("Nasa gate na po.");
    expect(clientRef).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    // The quick-reply chip and the sent bubble now both carry the text.
    expect(await screen.findAllByText("Nasa gate na po.")).toHaveLength(2);
  });

  it("out of signal, shows the message as waiting instead of losing it", async () => {
    state.send.mockImplementation(async (_trip, body, clientRef) => {
      state.outbox = [{ id: 9, kind: "message", path: "/trips/15/messages", json: { body, clientRef } }];
      return { queued: true };
    });
    render(<DriverChat tripId={15} ticketNo="TT-0015" onClose={() => {}} />);
    await screen.findByText("Saan ka na?");

    fireEvent.change(screen.getByLabelText("Message to dispatch"), { target: { value: "Walang signal dito" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Walang signal dito")).toBeInTheDocument();
    expect(screen.getByText(/Waiting for signal/)).toBeInTheDocument();
  });

  it("gives the words back when the server refuses them", async () => {
    state.send.mockRejectedValue(Object.assign(new Error("Keep a message under 1000 characters."), { status: 400 }));
    render(<DriverChat tripId={15} ticketNo="TT-0015" onClose={() => {}} />);
    await screen.findByText("Saan ka na?");

    const box = screen.getByLabelText("Message to dispatch");
    fireEvent.change(box, { target: { value: "Something long" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Keep a message under 1000 characters.");
    expect(box).toHaveValue("Something long");
  });

  it("is read-only once the trip is closed", async () => {
    state.thread = { messages: [msg(1, "Salamat!", false)], closed: true };
    render(<DriverChat tripId={15} ticketNo="TT-0015" onClose={() => {}} />);
    expect(await screen.findByText(/This trip is closed/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Message to dispatch")).toBeNull();
  });
});
