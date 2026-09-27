import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  thread: null,
  send: vi.fn(),
  read: vi.fn(),
  canSend: true,
  realtime: null,
}));

vi.mock("../../services/operations/chatService", () => ({
  getThread: () => Promise.resolve(state.thread),
  sendMessage: (...args) => state.send(...args),
  markRead: (...args) => { state.read(...args); return Promise.resolve(); },
  newClientRef: () => `ref-${Math.random().toString(36).slice(2, 12)}`,
}));
vi.mock("../../auth/permissions", () => ({
  usePermissions: () => ({ canAny: () => state.canSend }),
}));
vi.mock("../../services/realtime", () => ({
  useRealtime: (handler) => { state.realtime = handler; },
}));

const { default: TripChat } = await import("./TripChat");

const trip = { id: 15, ticketNo: "TT-0015", driver: "Jose Garcia", origin: "Taguig", destination: "Calamba" };
const msg = (id, body, extra = {}) => ({
  id, tripId: 15, senderKind: "driver", senderName: "Jose Garcia", body, clientRef: null,
  createdAt: new Date().toISOString(), mine: false, ...extra,
});

describe("dispatch chat with a driver", () => {
  beforeEach(() => {
    state.thread = { messages: [msg(1, "Nasa gate na po.")], closed: false, driver: { name: "Jose Garcia" } };
    state.send.mockReset();
    state.read.mockReset();
    state.canSend = true;
  });

  it("shows the driver's message, marks it read, and clears the badge", async () => {
    const onRead = vi.fn();
    render(<TripChat trip={trip} open onClose={() => {}} onRead={onRead} />);
    expect(await screen.findByText("Nasa gate na po.")).toBeInTheDocument();
    await waitFor(() => expect(state.read).toHaveBeenCalledWith(15, 1));
    expect(onRead).toHaveBeenCalledWith(15);
  });

  it("a message that fails is kept, marked, and retried with the same id", async () => {
    state.send.mockRejectedValueOnce(new Error("Network error")).mockImplementationOnce(
      async (_trip, body, clientRef) => msg(2, body, { senderKind: "staff", senderName: "Ana", mine: true, clientRef })
    );
    render(<TripChat trip={trip} open onClose={() => {}} />);
    await screen.findByText("Nasa gate na po.");

    fireEvent.change(screen.getByLabelText(/Message to Jose Garcia/), { target: { value: "Sige, tatawag ako." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Network error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    expect(state.send.mock.calls[1][2]).toBe(state.send.mock.calls[0][2]);
    await waitFor(() => expect(screen.queryByText("Network error")).toBeNull());
    expect(screen.getByText("Sige, tatawag ako.")).toBeInTheDocument();
  });

  it("a new message arriving live is added once", async () => {
    render(<TripChat trip={trip} open onClose={() => {}} />);
    await screen.findByText("Nasa gate na po.");
    state.realtime({ type: "trip:message", tripId: 15, message: msg(3, "Bukas na po ang gate.") });
    state.realtime({ type: "trip:message", tripId: 15, message: msg(3, "Bukas na po ang gate.") });
    state.realtime({ type: "trip:message", tripId: 99, message: msg(4, "Another trip") });
    expect(await screen.findAllByText("Bukas na po ang gate.")).toHaveLength(1);
    expect(screen.queryByText("Another trip")).toBeNull();
  });

  it("says why it is read-only", async () => {
    state.canSend = false;
    const { unmount } = render(<TripChat trip={trip} open onClose={() => {}} />);
    expect(await screen.findByText("You can read this conversation but not reply.")).toBeInTheDocument();
    unmount();

    state.canSend = true;
    state.thread = { ...state.thread, closed: true };
    render(<TripChat trip={trip} open onClose={() => {}} />);
    expect(await screen.findByText(/This trip is closed/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Message to/)).toBeNull();
  });
});
