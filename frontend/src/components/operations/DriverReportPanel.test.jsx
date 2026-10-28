import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  perms: new Set(),
  report: vi.fn(),
  photo: vi.fn(),
  approve: vi.fn(),
  decline: vi.fn(),
  resume: vi.fn(),
  thread: vi.fn(),
  reply: vi.fn(),
  link: vi.fn(),
  toast: vi.fn(),
  reattempt: vi.fn(),
  returned: vi.fn(),
}));

vi.mock("../../auth/permissions", () => ({ usePermissions: () => ({ can: (p) => state.perms.has(p) }) }));
vi.mock("../shared/Toast", () => ({ useToast: () => ({ addToast: state.toast }) }));
vi.mock("../../services/operations/exceptionService", () => ({
  getDriverReport: (...a) => state.report(...a),
  getReportPhoto: (...a) => state.photo(...a),
  approvePause: (...a) => state.approve(...a),
  declinePause: (...a) => state.decline(...a),
  resumePause: (...a) => state.resume(...a),
  getDriverThread: (...a) => state.thread(...a),
  replyToDriver: (...a) => state.reply(...a),
  reattemptDelivery: (...a) => state.reattempt(...a),
  returnDelivery: (...a) => state.returned(...a),
}));
vi.mock("../../services/operations/trackingService", () => ({
  getTrackingLink: (...a) => state.link(...a),
}));

import DriverReportPanel from "./DriverReportPanel";

const exception = (extra = {}) => ({ id: 12, tripTicketId: 31, status: "open", sourceKind: "pause", resolvedAt: null, ...extra });

const pause = (extra = {}) => ({
  id: 7, status: "pending", reason: "breakdown", reasonLabel: "Vehicle breakdown",
  description: "The engine overheated and stopped.", requestedAt: "2026-10-14T08:00:00",
  reviewedAt: null, reviewedByName: null, reviewNote: null, customerMessage: null, resumedAt: null, resumedBy: null,
  pausedMinutes: null, latitude: 7.0712, longitude: 125.6103, photos: [{ id: 1 }, { id: 2 }], ...extra,
});

const reportOf = (p = pause()) => ({ kind: "pause", ticketId: 41, pause: p });

describe("the driver's report inside an exception", () => {
  beforeEach(() => {
    state.perms = new Set(["exception.resolve", "support.read", "support.manage", "tracking.share"]);
    for (const k of ["report", "photo", "approve", "decline", "resume", "thread", "reply", "link", "toast"]) state[k].mockReset();
    state.report.mockResolvedValue(reportOf());
    state.photo.mockResolvedValue("data:image/png;base64,AAAA");
    state.approve.mockResolvedValue({ success: true, message: "Pause approved." });
    state.decline.mockResolvedValue({ success: true });
    state.resume.mockResolvedValue({ success: true });
    state.thread.mockResolvedValue({ ticketId: 41, status: "open", driverName: "Juan Dela Cruz", messages: [] });
  });

  it("shows nothing for an exception a driver did not file", () => {
    const { container } = render(<DriverReportPanel exception={exception({ sourceKind: null })} />);
    expect(container).toBeEmptyDOMElement();
    expect(state.report).not.toHaveBeenCalled();
  });

  it("shows what was reported: reason, the driver's words, when they pressed Send, where, and the photos", async () => {
    render(<DriverReportPanel exception={exception()} />);
    const card = await screen.findByRole("region", { name: "Driver report" });

    expect(within(card).getByText("Waiting for review")).toBeInTheDocument();
    expect(within(card).getByText("Vehicle breakdown")).toBeInTheDocument();
    expect(within(card).getByText("The engine overheated and stopped.")).toBeInTheDocument();
    expect(within(card).getByText("Sent by driver at")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /7\.0712, 125\.6103/ })).toHaveAttribute("href", expect.stringContaining("7.0712,125.6103"));
    expect(within(card).getByText("Evidence (2)")).toBeInTheDocument();
    expect(await within(card).findByRole("button", { name: "Open photo 1" })).toBeInTheDocument();
    expect(state.photo).toHaveBeenCalledWith(12, 1);
  });

  it("opens a photo large, and closes it again", async () => {
    render(<DriverReportPanel exception={exception()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open photo 1" }));
    const dialog = screen.getByRole("dialog", { name: "Photo" });
    expect(within(dialog).getByAltText("Evidence, enlarged")).toHaveAttribute("src", "data:image/png;base64,AAAA");
    fireEvent.click(within(dialog).getByRole("button", { name: /Close/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says plainly when an emergency came without photos", async () => {
    state.report.mockResolvedValue(reportOf(pause({ reason: "emergency", reasonLabel: "Emergency", photos: [] })));
    render(<DriverReportPanel exception={exception()} />);
    expect(await screen.findByText(/optional in an emergency/)).toBeInTheDocument();
  });

  it("approves a pause with a note for the driver and a message for the customer, and tells the page", async () => {
    const onChanged = vi.fn();
    render(<DriverReportPanel exception={exception()} onChanged={onChanged} />);
    fireEvent.change(await screen.findByLabelText("Note to the driver"), { target: { value: "Stay with the truck" } });
    fireEvent.change(screen.getByLabelText(/Message for the customer/), { target: { value: "Delayed by a mechanical fault." } });
    fireEvent.click(screen.getByRole("button", { name: "Approve pause" }));

    await waitFor(() => expect(state.approve).toHaveBeenCalledWith(12, { note: "Stay with the truck", customerMessage: "Delayed by a mechanical fault." }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(state.toast).toHaveBeenCalledWith("Pause approved.", "success");
  });

  it("will not decline without a reason for the driver", async () => {
    render(<DriverReportPanel exception={exception()} />);
    const decline = await screen.findByRole("button", { name: "Decline" });
    expect(decline).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Note to the driver"), { target: { value: "The road is open." } });
    expect(decline).toBeEnabled();
    fireEvent.click(decline);
    await waitFor(() => expect(state.decline).toHaveBeenCalledWith(12, { note: "The road is open." }));
  });

  it("shows the server's refusal beside the buttons, not only as a toast", async () => {
    state.approve.mockRejectedValue(new Error("Someone already answered this."));
    render(<DriverReportPanel exception={exception()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve pause" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone already answered this.");
  });

  it("offers Resume once approved, with how long the delivery has been held", async () => {
    state.report.mockResolvedValue(reportOf(pause({ status: "approved", reviewedAt: "2026-10-14T08:10:00", reviewedByName: "Ana Reyes", pausedMinutes: 75 })));
    render(<DriverReportPanel exception={exception({ status: "acknowledged" })} />);
    expect(await screen.findByText("Approved: delivery paused")).toBeInTheDocument();
    expect(screen.getByText("1 h 15 min so far")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve pause" })).toBeNull();
    fireEvent.click(screen.getByText("Add a message before resuming"));
    fireEvent.change(screen.getByLabelText("Note to the driver (optional)"), { target: { value: "Proceed when safe." } });
    fireEvent.change(screen.getByLabelText("Message for the customer (optional)"), { target: { value: "The delivery is moving again." } });
    fireEvent.click(screen.getByRole("button", { name: "Resume delivery" }));
    await waitFor(() => expect(state.resume).toHaveBeenCalledWith(12, {
      note: "Proceed when safe.", customerMessage: "The delivery is moving again.",
    }));
  });

  it("keeps the decision controls from people who may only look", async () => {
    state.perms = new Set();
    render(<DriverReportPanel exception={exception()} />);
    expect(await screen.findByText("Waiting for review")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Conversation with the driver" })).toBeNull();
    expect(screen.queryByRole("button", { name: /customer tracking link/ })).toBeNull();
  });

  it("shows the conversation and lets the office write to the driver", async () => {
    state.thread.mockResolvedValue({
      ticketId: 41, status: "open", driverName: "Juan Dela Cruz",
      messages: [{ id: 1, senderKind: "driver", senderName: "Juan Dela Cruz", body: "Flat tyre", createdAt: "2026-10-14T08:00:00" }],
    });
    state.reply.mockResolvedValue({ id: 2 });
    render(<DriverReportPanel exception={exception()} />);

    const thread = await screen.findByRole("region", { name: "Conversation with the driver" });
    expect(await within(thread).findByText("Flat tyre")).toBeInTheDocument();
    fireEvent.change(within(thread).getByLabelText("Write to the driver"), { target: { value: "Help is coming" } });
    fireEvent.click(within(thread).getByRole("button", { name: "Send to driver" }));
    await waitFor(() => expect(state.reply).toHaveBeenCalledWith(12, "Help is coming"));
  });

  it("does not offer to write on a conversation that is closed", async () => {
    state.thread.mockResolvedValue({ ticketId: 41, status: "closed", driverName: "Juan", messages: [] });
    render(<DriverReportPanel exception={exception()} />);
    expect(await screen.findByText("This request is closed.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Write to the driver")).toBeNull();
  });

  it("shows a concern from Help & Support with its request details instead of a pause", async () => {
    state.report.mockResolvedValue({
      kind: "support", ticketId: 41,
      ticket: { id: 41, ticketNo: "SUP-000041", category: "vehicle", priority: "urgent", subject: "Brakes feel soft", assignedName: null },
    });
    render(<DriverReportPanel exception={exception({ sourceKind: "support" })} />);
    expect(await screen.findByText("Driver's concern")).toBeInTheDocument();
    expect(screen.getByText("SUP-000041")).toBeInTheDocument();
    expect(screen.getByText("Brakes feel soft")).toBeInTheDocument();
    expect(screen.getByText("Nobody yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve pause" })).toBeNull();
  });

  it("copies the customer's tracking link", async () => {
    state.link.mockResolvedValue({ token: "abc", path: "/track/abc" });
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<DriverReportPanel exception={exception()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Copy customer tracking link/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/track/abc`));
    expect(state.link).toHaveBeenCalledWith(31);
    expect(state.toast).toHaveBeenCalledWith("Customer link copied.", "success");
  });
});

describe("an exception raised by a pre-trip inspection", () => {
  beforeEach(() => {
    state.report.mockReset().mockResolvedValue({ kind: "inspection", inspectionId: 5 });
    state.thread.mockReset();
  });

  it("points Fleet to the inspection, with no thread or pause controls", async () => {
    state.perms = new Set(["exception.resolve", "support.read", "inspection.read"]);
    render(<DriverReportPanel exception={exception({ sourceKind: "inspection" })} />, { wrapper: MemoryRouter });
    expect(await screen.findByRole("region", { name: "Pre-trip inspection" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the inspection" })).toHaveAttribute("href", "/fleet/inspections?open=5");
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(state.thread).not.toHaveBeenCalled();
  });

  it("offers no link to someone who cannot read inspections", async () => {
    state.perms = new Set(["exception.resolve"]);
    render(<DriverReportPanel exception={exception({ sourceKind: "inspection" })} />, { wrapper: MemoryRouter });
    await screen.findByRole("region", { name: "Pre-trip inspection" });
    expect(screen.queryByRole("link", { name: "Open the inspection" })).toBeNull();
  });
});

describe("a delivery report inside an exception", () => {
  const delivery = (extra = {}) => ({
    id: 31, tripId: 55, ticketNo: "TT-0055", tripStatus: "in_transit", driverName: "Juan Dela Cruz",
    outcome: "not_delivered", reason: "absent", reasonLabel: "Receiver absent or closed", status: "open",
    note: "Gate locked, nobody answering", qtyExpected: null, qtyDelivered: null, lat: 7.0712, lng: 125.6103,
    capturedAt: "2026-10-27T08:00:00", resolvedAt: null, resolutionNote: null, photos: [{ id: 1 }], ...extra,
  });
  const open = (d = delivery()) => {
    state.report.mockResolvedValue({ kind: "delivery", delivery: d });
    render(<DriverReportPanel exception={exception({ sourceKind: "delivery_report" })} onChanged={state.changed} />);
    return screen.findByRole("region", { name: "Delivery report" });
  };

  beforeEach(() => {
    state.perms = new Set(["exception.resolve", "support.read", "support.manage"]);
    for (const k of ["report", "photo", "thread", "reattempt", "returned", "toast"]) state[k].mockReset();
    state.changed = vi.fn();
    state.photo.mockResolvedValue("data:image/png;base64,AAAA");
    state.reattempt.mockResolvedValue({ success: true, message: "The driver has been asked to try again." });
    state.returned.mockResolvedValue({ success: true, message: "Trip returned." });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows what the driver reported: reason, words, where, and the photos", async () => {
    const region = await open();
    expect(within(region).getByRole("heading", { name: /Not delivered/ })).toBeInTheDocument();
    expect(within(region).getByText("Waiting for a decision")).toBeInTheDocument();
    expect(within(region).getByText("Receiver absent or closed")).toBeInTheDocument();
    expect(within(region).getByText("Gate locked, nobody answering")).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: /7\.0712, 125\.6103/ })).toHaveAttribute("href", expect.stringContaining("7.0712,125.6103"));
    expect(await within(region).findByAltText("Evidence 1")).toBeInTheDocument();
    // no conversation behind a delivery report
    expect(state.thread).not.toHaveBeenCalled();
  });

  it("asks the driver to try again, with a note", async () => {
    const region = await open();
    fireEvent.change(within(region).getByLabelText(/Note to the driver/), { target: { value: "Customer back at 3pm" } });
    fireEvent.click(within(region).getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(state.reattempt).toHaveBeenCalledWith(12, { note: "Customer back at 3pm" }));
    expect(state.toast).toHaveBeenCalledWith("The driver has been asked to try again.", "success");
    expect(state.changed).toHaveBeenCalled();
  });

  it("marks the trip returned only after confirming", async () => {
    window.confirm.mockReturnValueOnce(false);
    const region = await open();
    fireEvent.click(within(region).getByRole("button", { name: /Mark returned/ }));
    expect(state.returned).not.toHaveBeenCalled();
    fireEvent.click(within(region).getByRole("button", { name: /Mark returned/ }));
    await waitFor(() => expect(state.returned).toHaveBeenCalledWith(12, { note: "" }));
  });

  it("while the driver tries again, it can still be taken back but not asked twice", async () => {
    const region = await open(delivery({ status: "reattempt" }));
    expect(within(region).getByText("Driver trying again")).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /Try again/ })).toBeNull();
    expect(within(region).getByRole("button", { name: /Mark returned/ })).toBeInTheDocument();
  });

  it("a problem with a delivery that went through has nothing to decide here but its note", async () => {
    const region = await open(delivery({
      outcome: "delivered_with_issue", reason: "short", reasonLabel: "Short delivery", qtyExpected: 10, qtyDelivered: 8, tripStatus: "delivered",
    }));
    expect(within(region).getByRole("heading", { name: /Delivered with a problem/ })).toBeInTheDocument();
    expect(within(region).getByText("8 of 10")).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /Try again|Mark returned/ })).toBeNull();
  });

  it("settled, or without the right to decide: shown, not decided", async () => {
    let region = await open(delivery({ status: "returned", resolvedAt: "2026-10-27T10:00:00", resolutionNote: "Customer cancelled" }));
    expect(within(region).getByText("Returned")).toBeInTheDocument();
    expect(within(region).getByText(/Customer cancelled/)).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /Mark returned/ })).toBeNull();
    cleanup();
    state.perms = new Set(["exception.read"]);
    region = await open();
    expect(within(region).queryByRole("button", { name: /Try again|Mark returned/ })).toBeNull();
  });

  it("an error from the office's decision is shown, not lost", async () => {
    state.reattempt.mockRejectedValue(new Error("This report has already been decided."));
    const region = await open();
    fireEvent.click(within(region).getByRole("button", { name: /Try again/ }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("This report has already been decided.");
  });
});
