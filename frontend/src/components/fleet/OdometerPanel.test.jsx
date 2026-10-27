import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  perms: new Set(["vehicle.read", "vehicle.manage"]),
  get: vi.fn(),
  photo: vi.fn(),
  correct: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../auth/permissions", () => ({ usePermissions: () => ({ can: (p) => state.perms.has(p) }) }));
vi.mock("../shared/Toast", () => ({ useToast: () => ({ addToast: state.toast }) }));
vi.mock("../../services/fleet/odometerService", () => ({
  getTripOdometer: (...a) => state.get(...a),
  getOdometerPhoto: (...a) => state.photo(...a),
  correctOdometerReading: (...a) => state.correct(...a),
}));

const { default: OdometerPanel } = await import("./OdometerPanel");

const reading = (id, kind, valueKm, extra = {}) => ({
  id, kind, valueKm, correctedValueKm: null, effectiveKm: valueKm, capturedAt: "2026-10-26T06:00:00", hasPhoto: false,
  correctedAt: null, correctionReason: null, ...extra,
});

describe("the odometer on a trip", () => {
  beforeEach(() => {
    state.perms = new Set(["vehicle.read", "vehicle.manage"]);
    for (const k of ["get", "photo", "correct", "toast"]) state[k].mockReset();
    state.get.mockResolvedValue({ start: reading(1, "start", 120150), end: reading(2, "end", 120400), actualKm: 250 });
    state.photo.mockResolvedValue("data:image/png;base64,AAAA");
    state.correct.mockResolvedValue({ success: true });
  });

  it("shows the start, the end and the distance driven", async () => {
    render(<OdometerPanel tripId={41} />);
    expect(await screen.findByRole("region", { name: "Odometer" })).toBeInTheDocument();
    expect(screen.getByText(/120,150 km/)).toBeInTheDocument();
    expect(screen.getByText(/120,400 km/)).toBeInTheDocument();
    expect(screen.getByText("250 km")).toBeInTheDocument();
    expect(state.get).toHaveBeenCalledWith(41);
  });

  it("shows nothing for a trip with no readings", async () => {
    state.get.mockResolvedValue({ start: null, end: null, actualKm: null });
    const { container } = render(<OdometerPanel tripId={41} />);
    await waitFor(() => expect(state.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the driver's figure on show next to a correction, with its reason", async () => {
    state.get.mockResolvedValue({
      start: reading(1, "start", 12015, { correctedValueKm: 120150, effectiveKm: 120150, correctedAt: "2026-10-26T08:00:00", correctionReason: "Missed a digit" }),
      end: null,
      actualKm: null,
    });
    render(<OdometerPanel tripId={41} />);
    expect(await screen.findByText(/driver entered 12,015 km/)).toBeInTheDocument();
    expect(screen.getByText(/Missed a digit/)).toBeInTheDocument();
    expect(screen.getByText("Not recorded")).toBeInTheDocument();
  });

  it("loads the dashboard photo through the signed-in session", async () => {
    state.get.mockResolvedValue({ start: reading(1, "start", 120150, { hasPhoto: true }), end: null, actualKm: null });
    render(<OdometerPanel tripId={41} />);
    expect(await screen.findByAltText("Dashboard at the start")).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(state.photo).toHaveBeenCalledWith(1);
  });

  it("corrects a reading only with a value and a reason, then reloads", async () => {
    render(<OdometerPanel tripId={41} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Correct" }))[0]);
    const save = screen.getByRole("button", { name: "Save correction" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Correct start reading/), { target: { value: "120160" } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "ok" } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Photo shows 120160" } });
    fireEvent.click(save);
    await waitFor(() => expect(state.correct).toHaveBeenCalledWith(1, "120160", "Photo shows 120160"));
    expect(state.toast).toHaveBeenCalledWith("Reading corrected.", "success");
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(2));
  });

  it("shows the server's refusal and keeps the form open", async () => {
    state.correct.mockRejectedValue(new Error("With this correction the end reading would be lower than the start."));
    render(<OdometerPanel tripId={41} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Correct" }))[0]);
    fireEvent.change(screen.getByLabelText(/Correct start reading/), { target: { value: "130000" } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Photo shows it" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("lower than the start");
    expect(screen.getByRole("button", { name: "Save correction" })).toBeInTheDocument();
  });

  it("offers no correction to someone who cannot manage vehicles", async () => {
    state.perms = new Set(["vehicle.read"]);
    render(<OdometerPanel tripId={41} />);
    await screen.findByRole("region", { name: "Odometer" });
    expect(screen.queryByRole("button", { name: "Correct" })).toBeNull();
  });
});
