import { useState } from "react"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { setNet } from "./netStatus"

vi.mock("./netStatus", () => import("./netStatus.mock"))

const state = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  reply: vi.fn(),
  reopen: vi.fn(),
  trips: vi.fn(),
  pauses: vi.fn(),
  pauseCreate: vi.fn(),
  pauseResume: vi.fn(),
  pauseWithdraw: vi.fn(),
}))

vi.mock("./driverApi", () => ({
  driverSupportList: (...a) => state.list(...a),
  driverSupportGet: (...a) => state.get(...a),
  driverSupportCreate: (...a) => state.create(...a),
  driverSupportReply: (...a) => state.reply(...a),
  driverSupportReopen: (...a) => state.reopen(...a),
  driverTrips: (...a) => state.trips(...a),
  driverPauseHistory: (...a) => state.pauses(...a),
  driverPauseCreate: (...a) => state.pauseCreate(...a),
  driverPauseResume: (...a) => state.pauseResume(...a),
  driverPauseWithdraw: (...a) => state.pauseWithdraw(...a),
  driverPausePhoto: () => Promise.resolve("data:image/png;base64,AAAA"),
}))
vi.mock("./native", () => ({ tap: vi.fn() }))
vi.mock("./readPosition", () => ({ readPosition: () => Promise.resolve({ lat: 7.07, lng: 125.61 }) }))
// the real picker opens the camera; here a photo is added by a button
vi.mock("./PhotoPick", () => ({
  default: ({ onFile, takeLabel }) => (
    <button type="button" onClick={() => onFile(new File(["x"], "photo.jpg", { type: "image/jpeg" }))}>{takeLabel}</button>
  ),
}))

const { default: DriverSupport } = await import("./DriverSupport")

/** The app holds which screen is open, so the phone's back button has one place to ask. */
function Harness({ onBack = () => {}, start = null }) {
  const [detail, setDetail] = useState(start)
  return <DriverSupport detail={detail} onDetail={setDetail} onBack={onBack} />
}

const ticket = (extra = {}) => ({
  id: 41, ticketNo: "SUP-000041", category: "vehicle", priority: "normal", subject: "Flat tyre",
  status: "open", tripId: null, tripNo: null, assignedName: null, pause: null,
  createdAt: "2026-10-14T08:00:00", updatedAt: "2026-10-14T08:00:00", acknowledgedAt: null, resolvedAt: null,
  lastBody: "I have a flat tyre", lastSender: "driver", unread: false, ...extra,
})

const pause = (extra = {}) => ({
  id: 7, ticketId: 41, ticketNo: "SUP-000041", tripId: 31, tripNo: "TT-2026-000031", status: "pending",
  reason: "breakdown", reasonLabel: "Vehicle breakdown", description: "The engine overheated and stopped.",
  requestedAt: "2026-10-14T08:00:00", reviewedAt: null, reviewedByName: null, reviewNote: null,
  resumedAt: null, pausedMinutes: null, photos: [{ id: 1 }], ...extra,
})

describe("Help & Support", () => {
  beforeEach(() => {
    setNet("online")
    state.list.mockReset().mockResolvedValue([])
    state.get.mockReset()
    state.create.mockReset()
    state.reply.mockReset()
    state.reopen.mockReset().mockResolvedValue({})
    state.pauses.mockReset().mockResolvedValue([])
    state.pauseCreate.mockReset()
    state.pauseResume.mockReset().mockResolvedValue({})
    state.pauseWithdraw.mockReset().mockResolvedValue({})
    state.trips.mockReset().mockResolvedValue([{ id: 31, ticketNo: "TT-2026-000031", status: "in_transit" }])
  })

  it("offers four clear things to do, in words", async () => {
    render(<Harness />)
    expect(await screen.findByText("Nothing sent yet")).toBeInTheDocument()
    expect(screen.queryByRole("note")).toBeNull()
    for (const name of ["Pause delivery", "Report a problem", "Emergency", "FAQs and guides"]) {
      expect(screen.getByRole("button", { name: new RegExp(name) })).toBeInTheDocument()
    }
  })

  it("lists only the requests still being worked, and marks the ones with an answer not yet read", async () => {
    state.list.mockResolvedValue([
      ticket({ id: 41, unread: true, status: "in_progress", lastSender: "staff", lastBody: "On my way" }),
      ticket({ id: 39, subject: "Where is my allowance", status: "open", priority: "urgent", ticketNo: "SUP-000039" }),
      ticket({ id: 40, subject: "Pay question", status: "resolved", ticketNo: "SUP-000040" }),
    ]);
    render(<Harness />)

    const first = await screen.findByRole("button", { name: /Flat tyre, Being handled, new reply/ })
    expect(within(first).getByText("New reply")).toBeInTheDocument()
    expect(within(first).getByText("Office: On my way")).toBeInTheDocument()
    const second = screen.getByRole("button", { name: /Where is my allowance, Sent/ })
    expect(within(second).getByText("Urgent")).toBeInTheDocument()
    // the answered one first, then the rest; a finished request is not here at all
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Pay question/ })).toBeNull()
    expect(within(screen.getByRole("tab", { name: /Requests/ })).getByText("1")).toBeInTheDocument()
  })

  it("says whose move it is on each request, and puts the ones the office has answered first", async () => {
    state.list.mockResolvedValue([
      ticket({ id: 1, subject: "Still waiting", lastSender: "driver", unread: false }),
      ticket({ id: 2, subject: "Answered", lastSender: "staff", unread: false, status: "in_progress" }),
    ])
    render(<Harness />)
    const answered = await screen.findByRole("button", { name: /Answered/ })
    const waiting = screen.getByRole("button", { name: /Still waiting/ })
    expect(within(answered).getByText("Office replied")).toBeInTheDocument()
    expect(within(waiting).getByText("Waiting for the office")).toBeInTheDocument()
    expect(answered.compareDocumentPosition(waiting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("moves finished requests to History, saying how each one ended", async () => {
    state.list.mockResolvedValue([
      ticket({ id: 41, subject: "Active one", status: "open" }),
      ticket({ id: 40, subject: "Pause request: Vehicle breakdown (TT-1)", status: "resolved", ticketNo: "SUP-000040", resolvedAt: "2026-10-14T09:10:00", pause: { id: 7, status: "resumed", reason: "breakdown" } }),
      ticket({ id: 39, subject: "Pause request: Delivery delay (TT-2)", status: "closed", ticketNo: "SUP-000039", pause: { id: 6, status: "declined", reason: "delay" } }),
      ticket({ id: 38, subject: "Pay question", status: "resolved", ticketNo: "SUP-000038" }),
    ]);
    state.pauses.mockResolvedValue([pause({ id: 7, status: "resumed", pausedMinutes: 65 })]);
    render(<Harness />);
    fireEvent.click(await screen.findByRole("tab", { name: "History" }));

    const done = await screen.findByRole("button", { name: /Vehicle breakdown.*Resumed/ });
    expect(within(done).getByText("Held 1 h 5 min")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delivery delay.*Declined/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pay question, Resolved/ })).toBeInTheDocument();
    // the one still being worked is not history
    expect(screen.queryByRole("button", { name: /Active one/ })).toBeNull();

    // and it can be narrowed to one kind, or searched
    fireEvent.click(screen.getByRole("button", { name: "Pause requests" }));
    expect(screen.queryByRole("button", { name: /Pay question/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Delivery delay/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByPlaceholderText("Search past requests"), { target: { value: "allowance" } });
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search past requests"), { target: { value: "SUP-000038" } });
    expect(await screen.findByRole("button", { name: /Pay question/ })).toBeInTheDocument();
  });

  it("says Requests is clear when everything is finished, and points to History", async () => {
    state.list.mockResolvedValue([ticket({ id: 40, status: "resolved" })]);
    render(<Harness />);
    expect(await screen.findByText("No active requests")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open History" }));
    expect(await screen.findByRole("button", { name: /Flat tyre, Resolved/ })).toBeInTheDocument();
  });

  it("says so plainly when nothing has been finished yet", async () => {
    render(<Harness />);
    fireEvent.click(await screen.findByRole("tab", { name: "History" }));
    expect(await screen.findByText("No finished requests yet")).toBeInTheDocument();
  });

  it("shows no banner for a pause on the hub: it is listed under Requests like the rest", async () => {
    state.pauses.mockResolvedValue([pause({ status: "approved" })])
    render(<Harness />)
    await screen.findByText("Nothing sent yet")
    expect(screen.queryByText(/Your delivery is paused/)).toBeNull()
    expect(screen.queryByText(/Pause request waiting for the office/)).toBeNull()
  })

  it("answers questions without a signal: search, topics, and a guide that opens the right tool", async () => {
    render(<Harness />)
    fireEvent.click(await screen.findByRole("tab", { name: /FAQs/ }))

    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: "flat tyre" } })
    const q = await screen.findByRole("button", { name: /I have a flat tyre/ })
    fireEvent.click(q)
    expect(await screen.findByRole("region", { name: /I have a flat tyre/ })).toHaveTextContent("Park on firm, level ground")
    fireEvent.click(screen.getByRole("button", { name: "Request a pause" }))
    // the guide for a breakdown goes straight to the pause form
    expect(await screen.findByRole("heading", { name: /Pause delivery/ }).catch(() => null) || await screen.findByText("What happened?")).toBeTruthy()
  })

  it("says so when nothing in the FAQ matches, and offers the office", async () => {
    render(<Harness />)
    fireEvent.click(await screen.findByRole("tab", { name: /FAQs/ }))
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: "zzzzqqq" } })
    expect(await screen.findByText("No answers match")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Contact the office" }))
    expect(await screen.findByText("What is it about?")).toBeInTheDocument()
  })

  it("will not send a request with the important parts missing, and says which", async () => {
    render(<Harness />)
    fireEvent.click(await screen.findByRole("button", { name: /Report a problem/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Send to the office" }))

    expect(await screen.findByText("Choose what this is about.")).toBeInTheDocument()
    expect(screen.getByText("Give it a short title.")).toBeInTheDocument()
    expect(screen.getByText("Tell the office what happened or what you need.")).toBeInTheDocument()
    expect(state.create).not.toHaveBeenCalled()
  })

  it("files a request with its category, run and urgency, then points to the reply", async () => {
    state.create.mockResolvedValue({ success: true, data: ticket({ id: 77, ticketNo: "SUP-000077" }) })
    render(<Harness />)
    fireEvent.click(await screen.findByRole("button", { name: /Report a problem/ }))

    fireEvent.click(await screen.findByRole("button", { name: "Truck problem" }))
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "  Flat tyre on the highway " } })
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: "Km 42, stopped on the shoulder" } })
    fireEvent.click(await screen.findByRole("button", { name: "TT-2026-000031" }))
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Send to the office" }))

    expect(await screen.findByText("Sent to the office")).toBeInTheDocument()
    expect(screen.getByText(/SUP-000077/)).toBeInTheDocument()
    expect(state.create.mock.calls[0][0]).toMatchObject({
      category: "vehicle", subject: "Flat tyre on the highway", message: "Km 42, stopped on the shoulder", tripId: "31", urgent: true,
    })
  })

  it("offline, will not send a request, keeps what was typed, and sends it once back online", async () => {
    state.create.mockResolvedValue({ success: true, data: ticket({ id: 78, ticketNo: "SUP-000078" }) })
    render(<Harness />)
    fireEvent.click(await screen.findByRole("button", { name: /Report a problem/ }))
    fireEvent.click(await screen.findByRole("button", { name: "App or sign-in" }))
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Cannot sign in" } })
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: "It says wrong PIN" } })

    setNet("offline")
    expect(screen.getByRole("button", { name: "Send to the office" })).toBeDisabled()
    expect(screen.getByRole("note")).toHaveTextContent("Sending a request needs the internet")
    expect(screen.getByLabelText(/Title/)).toHaveValue("Cannot sign in")
    expect(state.create).not.toHaveBeenCalled()

    setNet("online")
    expect(screen.queryByRole("note")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Send to the office" }))
    expect(await screen.findByText("Sent to the office")).toBeInTheDocument()
  })

  it("the Emergency tile opens the pause form with an emergency already chosen, and needs no photo", async () => {
    state.pauseCreate.mockResolvedValue({ success: true, data: pause({ reason: "emergency" }) })
    render(<Harness />)
    fireEvent.click(await screen.findByRole("button", { name: /^Emergency/ }))

    expect(await screen.findByRole("radio", { name: /^Emergency/ })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText(/optional in an emergency/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Describe the problem/), { target: { value: "Someone was hurt at the gate." } })
    fireEvent.click(screen.getByRole("button", { name: "Send pause request" }))

    expect(await screen.findByText("Sent to the office")).toBeInTheDocument()
    const sent = state.pauseCreate.mock.calls[0]
    expect(sent[0]).toBe("31")
    expect(sent[1]).toMatchObject({ reason: "emergency", description: "Someone was hurt at the gate.", lat: 7.07, lng: 125.61, photos: [] })
  })

  it("will not send a pause request for a breakdown without a photo, or a description", async () => {
    render(<Harness />)
    fireEvent.click(await screen.findByRole("button", { name: /Pause delivery/ }))
    fireEvent.click(await screen.findByRole("radio", { name: /Vehicle breakdown/ }))
    fireEvent.click(screen.getByRole("button", { name: "Send pause request" }))

    expect(await screen.findByText("Describe what happened, in a sentence or two.")).toBeInTheDocument()
    expect(screen.getByText("Add at least one photo so the office can see the problem.")).toBeInTheDocument()
    expect(state.pauseCreate).not.toHaveBeenCalled()
  })

  it("sends a pause request with its reason, description, photos and position, and says it is not paused until approved", async () => {
    state.pauseCreate.mockResolvedValue({ success: true, data: pause() })
    render(<Harness />)
    fireEvent.click(await screen.findByRole("button", { name: /Pause delivery/ }))
    fireEvent.click(await screen.findByRole("radio", { name: /Vehicle breakdown/ }))
    fireEvent.change(screen.getByLabelText(/Describe the problem/), { target: { value: "The engine overheated and stopped." } })
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }))
    fireEvent.click(screen.getByRole("button", { name: "Send pause request" }))

    expect(await screen.findByText("Sent to the office")).toBeInTheDocument()
    expect(screen.getByText(/not paused until they approve/)).toBeInTheDocument()
    const [tripId, body] = state.pauseCreate.mock.calls[0]
    expect(tripId).toBe("31")
    expect(body).toMatchObject({ reason: "breakdown", description: "The engine overheated and stopped.", lat: 7.07, lng: 125.61 })
    expect(body.photos).toHaveLength(1)
    expect(body.clientRef).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
  })

  it("offline, a pause request cannot be sent and the driver is told to call in an emergency", async () => {
    render(<Harness />)
    fireEvent.click(await screen.findByRole("button", { name: /Pause delivery/ }))
    fireEvent.click(await screen.findByRole("radio", { name: /Delivery delay/ }))
    fireEvent.change(screen.getByLabelText(/Describe the problem/), { target: { value: "The highway is flooded ahead." } })

    setNet("offline")
    expect(screen.getByRole("button", { name: "Send pause request" })).toBeDisabled()
    expect(screen.getByText(/If this is an emergency, call the office./)).toBeInTheDocument()
    expect(screen.getByLabelText(/Describe the problem/)).toHaveValue("The highway is flooded ahead.")
    expect(state.pauseCreate).not.toHaveBeenCalled()
  })

  it("explains that a pause is only for a delivery on the road, and offers a general request instead", async () => {
    state.trips.mockResolvedValue([{ id: 31, ticketNo: "TT-1", status: "released" }])
    render(<Harness />)
    fireEvent.click(await screen.findByRole("button", { name: /Pause delivery/ }))
    expect(await screen.findByText("No delivery on the road")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Send a request instead" }))
    expect(await screen.findByText("What is it about?")).toBeInTheDocument()
  })

  it("shows a request's conversation with its progress, and lets the driver write back", async () => {
    state.list.mockResolvedValue([ticket({ status: "in_progress" })])
    state.get.mockResolvedValue({
      ...ticket({ status: "in_progress", assignedName: "Ana Reyes", acknowledgedAt: "2026-10-14T08:05:00" }),
      messages: [
        { id: 1, senderKind: "driver", senderName: "Juan Dela Cruz", body: "I have a flat tyre", createdAt: "2026-10-14T08:00:00", mine: true },
        { id: 2, senderKind: "staff", senderName: "Ana Reyes", body: "Stay safe, sending help", createdAt: "2026-10-14T08:05:00", mine: false },
      ],
    })
    state.reply.mockResolvedValue({ success: true, data: { id: 3 } })

    render(<Harness />)
    fireEvent.click(await screen.findByRole("button", { name: /Flat tyre, Being handled/ }))

    expect(await screen.findByText("Stay safe, sending help")).toBeInTheDocument()
    // where it is on the way: sent, answered, not yet resolved
    const progress = screen.getByRole("list", { name: "Progress" })
    expect(within(progress).getByText("Sent")).toBeInTheDocument()
    expect(within(progress).getByText("Answered")).toBeInTheDocument()
    expect(within(progress).getByText("Resolved")).toBeInTheDocument()
    expect(screen.getByText("Handled by Ana Reyes")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Write a message"), { target: { value: "Thank you" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(state.reply).toHaveBeenCalledWith(41, "Thank you", expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/)))
    await waitFor(() => expect(screen.getByLabelText("Write a message")).toHaveValue(""))
  })

  it("shows a pause request's card in its thread: what was reported, the answer, and a way to resume", async () => {
    state.list.mockResolvedValue([ticket({ pause: { id: 7, status: "approved", reason: "breakdown" }, subject: "Pause request: Vehicle breakdown (TT-2026-000031)" })])
    state.get.mockResolvedValue({
      ...ticket({ status: "in_progress" }),
      subject: "Pause request: Vehicle breakdown (TT-2026-000031)",
      pause: pause({ status: "approved", reviewedAt: "2026-10-14T08:10:00", reviewedByName: "Ana Reyes", reviewNote: "Take your time.", pausedMinutes: 42 }),
      messages: [{ id: 1, senderKind: "driver", senderName: "Juan", body: "The engine overheated and stopped.", createdAt: "2026-10-14T08:00:00", mine: true }],
    })
    render(<Harness />)
    fireEvent.click(await screen.findByRole("button", { name: /Pause request: Vehicle breakdown/ }))

    const card = await screen.findByRole("region", { name: "Pause request" })
    expect(within(card).getByText("Approved: delivery paused")).toBeInTheDocument()
    expect(within(card).getByText(/Your delivery is paused for 42 min/)).toBeInTheDocument()
    expect(within(card).getByText(/Take your time\./)).toBeInTheDocument()
    expect(within(card).getByText("Requested")).toBeInTheDocument()

    fireEvent.click(within(card).getByRole("button", { name: "Resume delivery" }))
    await waitFor(() => expect(state.pauseResume).toHaveBeenCalledWith(31))
  })

  it("lets a driver withdraw a pause request nobody has answered", async () => {
    state.list.mockResolvedValue([ticket({ pause: { id: 7, status: "pending", reason: "breakdown" }, subject: "Pause request: Vehicle breakdown (TT-1)" })])
    state.get.mockResolvedValue({ ...ticket(), subject: "Pause request: Vehicle breakdown (TT-1)", pause: pause({ status: "pending" }), messages: [] })
    render(<Harness />)
    fireEvent.click(await screen.findByRole("button", { name: /Pause request: Vehicle breakdown/ }))
    const card = await screen.findByRole("region", { name: "Pause request" })
    expect(within(card).getByText("Waiting for review")).toBeInTheDocument()
    expect(within(card).queryByRole("button", { name: "Resume delivery" })).toBeNull()
    fireEvent.click(within(card).getByRole("button", { name: "Withdraw request" }))
    await waitFor(() => expect(state.pauseWithdraw).toHaveBeenCalledWith(31))
  })

  it("offline, a reply waits in the box with Send off, and is not lost if sending fails", async () => {
    state.list.mockResolvedValue([ticket()])
    state.get.mockResolvedValue({ ...ticket(), messages: [] })
    state.reply.mockRejectedValue(Object.assign(new Error("You are offline. This needs an internet connection."), { offline: true }))
    render(<Harness />)
    fireEvent.click(await screen.findByRole("button", { name: /Flat tyre, Sent/ }))

    fireEvent.change(await screen.findByLabelText("Write a message"), { target: { value: "No signal here" } })
    setNet("offline")
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()

    // the connection dropped between the check and the send
    setNet("online")
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(await screen.findByText(/This needs an internet connection/)).toBeInTheDocument()
    expect(screen.getByLabelText("Write a message")).toHaveValue("No signal here")
  })

  it("closes a closed request to new words, and says so", async () => {
    state.list.mockResolvedValue([ticket({ status: "closed" })]);
    state.get.mockResolvedValueOnce({ ...ticket({ status: "closed" }), messages: [] });
    render(<Harness />);
    fireEvent.click(await screen.findByRole("tab", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /Flat tyre, Closed/ }));
    expect(await screen.findByText(/This request is closed/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Write a message")).toBeNull();
  });

  it("tells a driver that writing on a resolved request opens it again", async () => {
    state.list.mockResolvedValue([ticket({ status: "resolved" })]);
    state.get.mockResolvedValue({ ...ticket({ status: "resolved" }), messages: [] });
    render(<Harness />);
    fireEvent.click(await screen.findByRole("tab", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /Flat tyre, Resolved/ }));
    expect(await screen.findByText(/Writing here opens it again/)).toBeInTheDocument();
    expect(screen.getByLabelText("Write a message")).toBeInTheDocument();
  });


  it("lets a driver reopen a finished request with one tap, and it goes back to Requests", async () => {
    state.list.mockResolvedValue([ticket({ status: "closed" })]);
    state.get.mockResolvedValue({ ...ticket({ status: "closed" }), messages: [] });
    render(<Harness />);
    fireEvent.click(await screen.findByRole("tab", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /Flat tyre, Closed/ }));
    expect(await screen.findByText(/Reopen it if it is not fixed/)).toBeInTheDocument();

    state.get.mockResolvedValue({ ...ticket({ status: "open" }), messages: [] });
    fireEvent.click(screen.getByRole("button", { name: "Reopen request" }));
    await waitFor(() => expect(state.reopen).toHaveBeenCalledWith(41));
    // the thread now lets them write, and no longer offers to reopen
    expect(await screen.findByLabelText("Write a message")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reopen request" })).toBeNull();
  });

  it("offers to reopen a resolved request too, and shows why when the office's rules say no", async () => {
    state.list.mockResolvedValue([ticket({ status: "resolved" })]);
    state.get.mockResolvedValue({ ...ticket({ status: "resolved" }), messages: [] });
    state.reopen.mockRejectedValue(new Error("This request was finished more than 30 days ago. Please send a new one."));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("tab", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /Flat tyre, Resolved/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Reopen request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("more than 30 days ago");
  });

  it("does not offer to reopen a pause request: a problem that comes back is a new request", async () => {
    state.list.mockResolvedValue([ticket({ status: "closed", subject: "Pause request: Delivery delay (TT-1)", pause: { id: 6, status: "declined", reason: "delay" } })]);
    state.get.mockResolvedValue({
      ...ticket({ status: "closed", subject: "Pause request: Delivery delay (TT-1)" }),
      pause: pause({ status: "declined" }), messages: [],
    });
    render(<Harness />);
    fireEvent.click(await screen.findByRole("tab", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /Delivery delay.*Declined/ }));
    expect(await screen.findByText(/This request is closed. Start a new one/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reopen request" })).toBeNull();
  });

})
