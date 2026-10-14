import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ photo: vi.fn() }));
vi.mock("../../services/fleet/driverService", () => ({
  getDriverPhoto: (...args) => state.photo(...args),
}));
vi.mock("../../services/operations/dispatchService", () => ({ fmtDateTime: (v) => String(v ?? "") }));
vi.mock("../fleet/VehiclePhoto", () => ({ default: () => null }));
vi.mock("./TripStatusBadge", () => ({ default: () => null }));

import TrackingDetailPanel from "./TrackingDetailPanel";

const trip = {
  id: 19, ticketNo: "DVO-2026-0019", origin: "Davao City", destination: "Zamboanga City",
  status: "in_transit", driverId: 4, driver: "Juan Dela Cruz", vehicleType: "Box Truck",
  vehicleCapacityKg: 8000, cargoWeightKg: 2100,
};

const render_ = (props = {}) =>
  render(<TrackingDetailPanel trip={trip} tracking={null} navigate={() => {}} {...props} />);

describe("the driver on the Live Tracking panel", () => {
  beforeEach(() => { state.photo.mockReset(); });

  it("shows who is driving, with the picture they uploaded, above the call and chat buttons", async () => {
    state.photo.mockResolvedValue("data:image/png;base64,AAAA");
    const { container } = render_({
      driverContact: { id: 4, phone: "0917 123 4567", hasPhoto: true, photoUpdatedAt: "t1" },
    });

    expect(screen.getByText("Juan Dela Cruz")).toBeInTheDocument();
    expect(screen.getByText("Driver · 0917 123 4567")).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector(".tk-driver-face img")).toHaveAttribute("src", "data:image/png;base64,AAAA"));

    const row = container.querySelector(".tk-driver-row");
    const call = screen.getByText(/Call driver/);
    expect(row.compareDocumentPosition(call) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows initials when the driver has not uploaded a picture, and does not ask for one", () => {
    const { container } = render_({ driverContact: { id: 4, phone: "0917 123 4567", hasPhoto: false } });
    expect(container.querySelector(".tk-driver-face")).toHaveTextContent("JD");
    expect(state.photo).not.toHaveBeenCalled();
  });

  it("still names the driver for someone who may not read driver records, with initials only", () => {
    const { container } = render_({ driverContact: null });
    expect(screen.getByText("Juan Dela Cruz")).toBeInTheDocument();
    expect(container.querySelector(".tk-driver-face")).toHaveTextContent("JD");
    expect(state.photo).not.toHaveBeenCalled();
  });

  it("shows no driver row when no driver is assigned", () => {
    const { container } = render_({ trip: { ...trip, driverId: null, driver: null } });
    expect(container.querySelector(".tk-driver-row")).toBeNull();
  });

  it("explains a pause on the trip, so a stopped truck is not read as a lost signal", () => {
    const onOpenExceptions = vi.fn();
    render_({
      trip: { ...trip, pause: { id: 1, status: "approved", reason: "breakdown", reasonLabel: "Vehicle breakdown" } },
      onOpenExceptions,
    });
    const note = screen.getByRole("status");
    expect(note).toHaveTextContent("Delivery paused: Vehicle breakdown");
    expect(note).toHaveTextContent("not a lost signal");
    fireEvent.click(screen.getByRole("button", { name: "Review in Exceptions" }));
    expect(onOpenExceptions).toHaveBeenCalled();
  });

  it("says a pause is only requested while the office has not answered", () => {
    render_({ trip: { ...trip, pause: { id: 1, status: "pending", reason: "delay", reasonLabel: "Delivery delay" } } });
    expect(screen.getByRole("status")).toHaveTextContent("Pause requested: Delivery delay");
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the office");
  });

  it("shows no pause note on a trip with no pause, and no link button without permission to share", () => {
    render_();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: /customer tracking link/ })).toBeNull();
  });

  it("offers the customer's tracking link to someone who may share it", () => {
    const onCopyLink = vi.fn();
    render_({ onCopyLink });
    fireEvent.click(screen.getByRole("button", { name: /Copy customer tracking link/ }));
    expect(onCopyLink).toHaveBeenCalled();
  });
});
