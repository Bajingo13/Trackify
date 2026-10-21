import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setNet } from "./netStatus";

vi.mock("./netStatus", () => import("./netStatus.mock"));

const state = vi.hoisted(() => ({
  thread: { messages: [], closed: false },
  send: vi.fn(),
  sendPhoto: vi.fn(),
  photo: vi.fn(),
  podPhoto: vi.fn(),
  deleteChat: vi.fn(),
  read: vi.fn(),
  outbox: [],
}));
vi.mock("./PhotoPick", () => ({
  // The real one opens the camera or gallery; the test only needs a file handed over.
  default: ({ onFile }) => (
    <button type="button" onClick={() => onFile(new File(["x"], "receipt.jpg", { type: "image/jpeg" }))}>Take photo</button>
  ),
}));

vi.mock("./driverApi", () => ({
  currentDriverId: () => 7,
  driverMessages: () => Promise.resolve(state.thread),
  driverSendMessage: (...args) => state.send(...args),
  driverSendPhoto: (...args) => state.sendPhoto(...args),
  driverChatPhoto: (...args) => state.photo(...args),
  driverPodPhoto: (...args) => state.podPhoto(...args),
  driverDeleteChat: (...args) => state.deleteChat(...args),
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
  /** Open the "+" tray, then choose the photo. */
  const attach = () => {
    fireEvent.click(screen.getByRole("button", { name: "Attach a photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
  };

  beforeEach(() => {
    state.thread = { messages: [msg(1, "Saan ka na?", false)], closed: false };
    state.send.mockReset();
    state.sendPhoto.mockReset();
    state.photo.mockReset();
    state.podPhoto.mockReset();
    state.deleteChat.mockReset();
    state.read.mockReset();
    state.outbox = [];
  });

  it("sends a photo with a caption, and keeps it in the thread", async () => {
    state.sendPhoto.mockResolvedValue({ data: msg(2, "Na-deliver na, pirmado", true, { hasPhoto: true }) });
    state.photo.mockResolvedValue("data:image/jpeg;base64,AAAA");
    render(<DriverChat tripId={15} ticketNo="TT-0015" onClose={() => {}} />);
    await screen.findByText("Saan ka na?");

    attach();
    expect(screen.getByText(/Photo ready/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Message to dispatch"), { target: { value: "Na-deliver na, pirmado" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(state.sendPhoto).toHaveBeenCalledTimes(1));
    const [tripId, file, caption, clientRef] = state.sendPhoto.mock.calls[0];
    expect(tripId).toBe(15);
    expect(file.name).toBe("receipt.jpg");
    expect(caption).toBe("Na-deliver na, pirmado");
    expect(clientRef).toMatch(/^[A-Za-z0-9_-]{8,64}$/);

    expect(await screen.findByRole("button", { name: /Open Photo: Na-deliver na, pirmado/ })).toBeInTheDocument();
    expect(screen.queryByText(/Photo ready/)).toBeNull();
  });

  it("keeps the camera and gallery choice out of sight until \"+\" is pressed, and closes it once a photo is chosen", async () => {
    render(<DriverChat tripId={15} ticketNo="TT-0015" onClose={() => {}} />);
    await screen.findByText("Saan ka na?");
    expect(screen.queryByRole("button", { name: "Take photo" })).toBeNull();

    const plus = screen.getByRole("button", { name: "Attach a photo" });
    fireEvent.click(plus);
    expect(plus).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    expect(screen.queryByRole("button", { name: "Take photo" })).toBeNull();
    expect(screen.getByText(/Photo ready/)).toBeInTheDocument();
  });

  it("can send a photo with no words at all", async () => {
    state.sendPhoto.mockResolvedValue({ queued: true });
    render(<DriverChat tripId={15} ticketNo="TT-0015" onClose={() => {}} />);
    await screen.findByText("Saan ka na?");

    attach();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(state.sendPhoto).toHaveBeenCalledTimes(1));
    expect(state.sendPhoto.mock.calls[0][2]).toBe("");
  });

  it("gives the photo back when the server refuses it", async () => {
    state.sendPhoto.mockRejectedValue(Object.assign(new Error("The photo must be a JPG, PNG, WebP or HEIC image."), { status: 400 }));
    render(<DriverChat tripId={15} ticketNo="TT-0015" onClose={() => {}} />);
    await screen.findByText("Saan ka na?");

    attach();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The photo must be a JPG");
    expect(screen.getByText(/Photo ready/)).toBeInTheDocument();
  });

  it("shows a photo waiting in the outbox as waiting, not lost", async () => {
    state.outbox = [{
      id: 9, kind: "photo", path: "/trips/15/messages/photo",
      form: [
        { k: "photo", file: { blob: new Blob(["x"], { type: "image/jpeg" }), name: "a.jpg", type: "image/jpeg" } },
        { k: "body", v: "Sirang side mirror" },
        { k: "clientRef", v: "ref-photo-0001" },
      ],
    }];
    render(<DriverChat tripId={15} ticketNo="TT-0015" onClose={() => {}} />);
    expect(await screen.findByText("Sirang side mirror")).toBeInTheDocument();
    expect(screen.getByText(/Waiting for signal/)).toBeInTheDocument();
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

  it("still shows a message an older build saved in the outbox as waiting", async () => {
    state.outbox = [{ id: 9, kind: "message", path: "/trips/15/messages", json: { body: "Walang signal dito", clientRef: "old-build-ref-1" } }];
    render(<DriverChat tripId={15} ticketNo="TT-0015" onClose={() => {}} />);
    await screen.findByText("Saan ka na?");

    expect(await screen.findByText("Walang signal dito")).toBeInTheDocument();
    expect(screen.getByText(/Waiting for signal/)).toBeInTheDocument();
  });

  it("sends the same words again under the same clientRef, so a lost answer is not stored twice", async () => {
    state.send
      .mockRejectedValueOnce(Object.assign(new Error("You're offline."), { offline: true }))
      .mockResolvedValueOnce({ data: null });
    render(<DriverChat tripId={15} ticketNo="TT-0015" onClose={() => {}} />);
    await screen.findByText("Saan ka na?");

    fireEvent.change(screen.getByLabelText("Message to dispatch"), { target: { value: "Nasa gate" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("You're offline.");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    expect(state.send.mock.calls[1][2]).toBe(state.send.mock.calls[0][2]);
  });

  it("gives different words a new clientRef", async () => {
    state.send
      .mockRejectedValueOnce(Object.assign(new Error("You're offline."), { offline: true }))
      .mockResolvedValueOnce({ data: null });
    render(<DriverChat tripId={15} ticketNo="TT-0015" onClose={() => {}} />);
    await screen.findByText("Saan ka na?");

    const box = screen.getByLabelText("Message to dispatch");
    fireEvent.change(box, { target: { value: "Nasa gate" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("You're offline.");
    fireEvent.change(box, { target: { value: "Nasa gate na po" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    expect(state.send.mock.calls[1][2]).not.toBe(state.send.mock.calls[0][2]);
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

  it("puts all submitted completion details into a clear card", async () => {
    state.thread = {
      messages: [], closed: true,
      completion: {
        state: "closed", receivedBy: "Maria Santos", lat: 6.7501, lng: 125.356,
        note: "Two crates short", confirmedAt: "2026-10-17T08:30:00Z",
        completedAt: "2026-10-17T09:00:00Z", driverName: "Jose Garcia", hasPhoto: true,
      },
    };
    state.podPhoto.mockResolvedValue("data:image/jpeg;base64,AAAA");
    render(<DriverChat tripId={15} ticketNo="TT-0015" onClose={() => {}} />);

    const card = await screen.findByRole("region", { name: "Completed trip details" });
    expect(within(card).getByText("Maria Santos")).toBeInTheDocument();
    expect(within(card).getByText("6.75010, 125.35600")).toBeInTheDocument();
    expect(within(card).getByText("Two crates short")).toBeInTheDocument();
    expect(card.textContent.indexOf("Name")).toBeLessThan(card.textContent.indexOf("Location"));
    expect(await within(card).findByRole("button", { name: "Open proof of delivery photo" })).toBeInTheDocument();
  });

  it("offers Delete Chat for the current driver's conversation", async () => {
    state.deleteChat.mockResolvedValue({ success: true });
    const onClose = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    render(<DriverChat tripId={15} ticketNo="TT-0015" onClose={onClose} />);
    await screen.findByText("Saan ka na?");

    fireEvent.click(screen.getByRole("button", { name: "Delete Chat" }));
    await waitFor(() => expect(state.deleteChat).toHaveBeenCalledWith(15));
    expect(onClose).toHaveBeenCalled();
  });
});
