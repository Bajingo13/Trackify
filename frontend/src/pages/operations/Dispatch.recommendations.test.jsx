import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  board: vi.fn(),
  recommendations: vi.fn(),
  assign: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../components/layout/AppShell", () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock("../../components/operations/DispatchHero", () => ({ default: () => <div>Dispatch summary</div> }));
vi.mock("../../components/fleet/VehiclePhoto", () => ({ default: ({ type }) => <span aria-label={`${type} vehicle`} /> }));
vi.mock("../../services/realtime", () => ({ useRealtime: () => {} }));
vi.mock("../../components/shared/Toast", () => ({ useToast: () => ({ addToast: state.toast }) }));
vi.mock("../../services/operations/dispatchService", () => ({
  getDispatchBoard: (...args) => state.board(...args),
  getDispatchRecommendations: (...args) => state.recommendations(...args),
  assignTrip: (...args) => state.assign(...args),
  validateAssignment: () => ({ checks: [], ready: true }),
  fmtDate: (value) => String(value || "—"),
  fmtDateTime: (value) => String(value || "Not scheduled"),
}));

const trip = {
  id: 10,
  trip_ticket_id: 10,
  ticketNo: "DVO-2026-0010",
  customer: "Davao Fresh Market",
  origin: "Bukidnon",
  destination: "Davao City",
  scheduledDeparture: "2026-11-11 05:00:00",
  scheduledArrival: "2026-11-11 09:00:00",
  cargoDescription: "Banana Hearts",
  cargoWeight: 3600,
  status: "approved",
};

const driver = {
  id: 1,
  name: "Paul Elisha Panhilason Rosal",
  employeeNo: "DRV-016",
  licenseNo: "D38-22-304360",
  licenseExpiry: "2027-11-07",
};

const recommendedVehicle = {
  id: 2,
  plateNo: "CEB 2003",
  type: "Box Truck",
  capacity: 4000,
  registrationExpiry: "2027-08-20",
  homeBranchId: 3,
  eligible: true,
  rank: 1,
  score: 65,
  reasons: ["3,600 of 4,000 kg capacity", "Cross-branch from Cebu Branch; confirmation required"],
};

const snapshot = {
  recommendationId: "12345678-1234-1234-1234-123456789abc",
  trip: { id: 10 },
  drivers: [{ ...driver, eligible: true, rank: 1, score: 87, reasons: ["Active and licence-valid", "Based in Davao Branch"] }],
  vehicles: [
    recommendedVehicle,
    {
      id: 3,
      plateNo: "GEN 3002",
      type: "Refrigerated Van",
      capacity: 3000,
      eligible: false,
      rank: null,
      score: 35,
      reasons: ["Capacity short by 600 kg"],
    },
  ],
};

const { default: DispatchPage } = await import("./Dispatch");

function clickableForText(text) {
  return screen.getAllByText(text).map((node) => node.closest('[role="button"]')).find(Boolean);
}

describe("dispatch recommendation data in the single resource picker", () => {
  beforeEach(() => {
    state.board.mockReset().mockResolvedValue({
      unassignedTrips: [trip],
      availableDrivers: [driver],
      availableVehicles: [],
    });
    state.recommendations.mockReset().mockResolvedValue(snapshot);
    state.assign.mockReset().mockResolvedValue({ message: "Trip assigned" });
    state.toast.mockReset();
  });

  it("merges an eligible cross-branch recommendation into the existing list and hides blocked options", async () => {
    const { container } = render(<DispatchPage />);
    await screen.findAllByText("DVO-2026-0010");
    fireEvent.click(clickableForText("DVO-2026-0010"));

    expect(await screen.findAllByText("Best Match")).toHaveLength(2);
    expect(screen.queryByText("87")).not.toBeInTheDocument();
    expect(screen.queryByText("65")).not.toBeInTheDocument();
    expect(clickableForText("CEB 2003")).toBeTruthy();
    expect(screen.getByText(/Cross-branch from Cebu Branch/i)).toBeInTheDocument();
    expect(screen.queryByText("GEN 3002")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /choose paul/i })).not.toBeInTheDocument();

    const resourceColumns = container.querySelectorAll(".ops-dispatch-column");
    expect(within(resourceColumns[1]).getByText("1")).toBeInTheDocument();
    expect(within(resourceColumns[2]).getByText("1")).toBeInTheDocument();
  });

  it("labels the unassigned trip arrival as a scheduled ETA", async () => {
    render(<DispatchPage />);
    expect(await screen.findByText(/Scheduled ETA:/i)).toBeInTheDocument();
    expect(screen.queryByText(/Live operational estimate/i)).not.toBeInTheDocument();
  });

  it("assigns the pair selected from the existing lists with its recommendation snapshot", async () => {
    const { container } = render(<DispatchPage />);
    await screen.findAllByText("DVO-2026-0010");
    fireEvent.click(clickableForText("DVO-2026-0010"));
    await screen.findAllByText("Best Match");

    fireEvent.click(clickableForText("Paul Elisha Panhilason Rosal"));
    fireEvent.click(clickableForText("CEB 2003"));

    const pairbar = container.querySelector(".tk-pairbar");
    expect(within(pairbar).getByText(/Paul Elisha Panhilason Rosal/)).toBeInTheDocument();
    expect(within(pairbar).getByText(/CEB 2003/)).toBeInTheDocument();
    fireEvent.click(within(pairbar).getByRole("button", { name: "Assign" }));

    await waitFor(() => expect(state.assign).toHaveBeenCalledWith(
      10,
      1,
      2,
      { recommendationId: snapshot.recommendationId },
    ));
    expect(state.toast).toHaveBeenCalledWith("Trip assigned", "success");
  });
});
