import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  thread: null,
  send: vi.fn(),
  read: vi.fn(),
  photo: vi.fn(),
  completionPhoto: vi.fn(),
  deleteChat: vi.fn(),
  canSend: true,
  realtime: null,
}));

vi.mock("../../services/operations/chatService", () => ({
  getThread: () => Promise.resolve(state.thread),
  sendMessage: (...args) => state.send(...args),
  markRead: (...args) => { state.read(...args); return Promise.resolve(); },
  getPhoto: (...args) => state.photo(...args),
  getCompletionPhoto: (...args) => state.completionPhoto(...args),
  deleteChat: (...args) => state.deleteChat(...args),
  setOpenChat: () => {},
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
    state.photo.mockReset();
    state.completionPhoto.mockReset();
    state.deleteChat.mockReset();
    state.canSend = true;
  });

  it("shows a photo the driver sent in the thread, with its caption, and opens it full size", async () => {
    state.photo.mockResolvedValue("data:image/jpeg;base64,AAAA");
    state.thread = {
      messages: [msg(2, "Resibo ng diesel", { hasPhoto: true })],
      closed: true,
      driver: { name: "Jose Garcia" },
    };
    render(<TripChat trip={trip} open onClose={() => {}} />);

    // First test in the file: the drawer's animation and role queries are slow on a cold jsdom.
    const open = await screen.findByRole("button", { name: /Open Photo: Resibo ng diesel/ }, { timeout: 5000 });
    expect(state.photo).toHaveBeenCalledWith(15, 2);
    expect(screen.getByText("Resibo ng diesel")).toBeInTheDocument();

    fireEvent.click(open);
    const viewer = screen.getByRole("dialog", { name: /Photo: Resibo ng diesel/ });
    fireEvent.click(within(viewer).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: /Photo: Resibo ng diesel/ })).toBeNull();
  }, 15000);

  it("says so when a photo cannot be loaded, and tries again on request", async () => {
    state.photo.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("data:image/jpeg;base64,AAAA");
    state.thread = { messages: [msg(2, "", { hasPhoto: true })], closed: false, driver: { name: "Jose Garcia" } };
    render(<TripChat trip={trip} open onClose={() => {}} />);

    expect(await screen.findByText(/Photo could not be loaded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByRole("button", { name: /Open Photo from the driver/ }, { timeout: 5000 })).toBeInTheDocument();
  }, 15000);

  it("shows the driver's message, marks it read, and clears the badge", async () => {
    const onRead = vi.fn();
    render(<TripChat trip={trip} open onClose={() => {}} onRead={onRead} />);
    expect(await screen.findByText("Nasa gate na po.")).toBeInTheDocument();
    await waitFor(() => expect(state.read).toHaveBeenCalledWith(15, 1));
    expect(onRead).toHaveBeenCalledWith(15);
  });

  it("keeps the admin composer compact and bottom-aligned", async () => {
    render(<TripChat trip={trip} open onClose={() => {}} />);
    const input = await screen.findByLabelText(/Message to Jose Garcia/);
    expect(input).toHaveAttribute("rows", "1");
    expect(screen.getByRole("button", { name: "Send" })).toHaveClass("tc-send");
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

  it("automatically adds the completion card when the trip becomes done", async () => {
    render(<TripChat trip={trip} open onClose={() => {}} />);
    await screen.findByText("Nasa gate na po.");
    state.thread = {
      ...state.thread,
      completion: {
        state: "done", receivedBy: "Maria Santos", lat: 6.75, lng: 125.356,
        note: null, confirmedAt: "2026-10-17T08:30:00Z",
        completedAt: "2026-10-17T08:30:00Z", driverName: "Jose Garcia", hasPhoto: false,
      },
    };

    state.realtime({ type: "trip:status", tripId: 15, status: "delivered" });
    const card = await screen.findByRole("region", { name: "Completed trip details" });
    expect(within(card).getByText("Done")).toBeInTheDocument();
    expect(within(card).getByText("Maria Santos")).toBeInTheDocument();
  });

  it("shows the driver's number beside Call, from the thread when the screen passed none", async () => {
    state.thread = { ...state.thread, driver: { name: "Jose Garcia", phone: "0917 555 0101" } };
    render(<TripChat trip={trip} open onClose={() => {}} />);
    expect(await screen.findByText("0917 555 0101")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Call/ })).toHaveAttribute("href", "tel:0917 555 0101");
  });

  it("with no number on file, says so and the Call button dials nothing", async () => {
    render(<TripChat trip={trip} open onClose={() => {}} />);
    expect(await screen.findByText("No phone number on file")).toBeInTheDocument();
    const call = screen.getByText("Call").closest("a");
    expect(call).not.toHaveAttribute("href");
    expect(call).toHaveAttribute("aria-disabled", "true");
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

  it("shows the completed form as an organized chat card with location directly after name", async () => {
    state.thread = {
      messages: [], closed: true, driver: { name: "Jose Garcia" },
      completion: {
        state: "closed", receivedBy: "Maria Santos", lat: 6.7501, lng: 125.356,
        note: "Two crates short", confirmedAt: "2026-10-17T08:30:00Z",
        completedAt: "2026-10-17T09:00:00Z", driverName: "Jose Garcia", hasPhoto: true,
      },
    };
    state.completionPhoto.mockResolvedValue("data:image/jpeg;base64,AAAA");
    render(<TripChat trip={trip} open onClose={() => {}} />);

    const card = await screen.findByRole("region", { name: "Completed trip details" });
    expect(within(card).getByText("Closed")).toBeInTheDocument();
    expect(within(card).getByText("Maria Santos")).toBeInTheDocument();
    expect(within(card).getByText("6.75010, 125.35600")).toBeInTheDocument();
    expect(within(card).getByText("Two crates short")).toBeInTheDocument();
    expect(card.textContent.indexOf("Name")).toBeLessThan(card.textContent.indexOf("Location"));
    expect(await within(card).findByRole("button", { name: "Open proof of delivery photo" })).toBeInTheDocument();
  });

  it("deletes only this user's conversation after confirmation", async () => {
    state.deleteChat.mockResolvedValue({ success: true });
    const onClose = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    render(<TripChat trip={trip} open onClose={onClose} />);
    await screen.findByText("Nasa gate na po.");

    fireEvent.click(screen.getByRole("button", { name: "Delete Chat" }));
    await waitFor(() => expect(state.deleteChat).toHaveBeenCalledWith(15));
    expect(onClose).toHaveBeenCalled();
  });
});
