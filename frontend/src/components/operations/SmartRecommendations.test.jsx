import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../../services/operations/dispatchService", () => ({
  getDispatchRecommendations: (...args) => state.load(...args),
}));

const { default: SmartRecommendations } = await import("./SmartRecommendations");

const result = {
  recommendationId: "12345678-1234-1234-1234-123456789abc",
  trip: { id: 5, ticketNo: "TT-5", originLat: 14.55 },
  drivers: [
    { id: 2, rank: 1, score: 94, eligible: true, name: "Ana Driver", employeeNo: "DRV-002", reasons: ["Active and licence-valid", "1.2 km from pickup"] },
  ],
  vehicles: [
    { id: 7, rank: 1, score: 91, eligible: true, plateNo: "ABC 1234", type: "Box Truck", reasons: ["2,000 of 3,000 kg capacity", "Matches required Box Truck"] },
    { id: 8, rank: null, score: 55, eligible: false, plateNo: "BAD 999", type: "Tanker", reasons: ["Requires Box Truck; this is Tanker"] },
  ],
};

describe("SmartRecommendations", () => {
  beforeEach(() => {
    state.load.mockReset();
    state.load.mockResolvedValue(result);
  });

  it("loads guidance without creating a second resource picker", async () => {
    const onSnapshot = vi.fn();
    render(
      <SmartRecommendations
        trip={{ id: 5 }}
        onSnapshot={onSnapshot}
      />
    );
    expect(await screen.findByText("Ana Driver")).toBeInTheDocument();
    expect(screen.getByText("ABC 1234")).toBeInTheDocument();
    expect(screen.getByText(/marked in the lists below/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /choose ana driver/i })).not.toBeInTheDocument();
    expect(state.load).toHaveBeenCalledWith(5);
    expect(onSnapshot).toHaveBeenCalledWith(result);
  });

  it("refreshes guidance without selecting or assigning anything", async () => {
    render(<SmartRecommendations trip={{ id: 5 }} />);
    await screen.findByText("Ana Driver");
    fireEvent.click(screen.getByRole("button", { name: "Refresh recommendations" }));
    await waitFor(() => expect(state.load).toHaveBeenCalledTimes(2));
  });

  it("shows a useful retry when recommendations fail", async () => {
    state.load.mockRejectedValueOnce(new Error("Trackify could not load recommendations."));
    render(<SmartRecommendations trip={{ id: 5 }} />);
    expect(await screen.findByText(/recommendations unavailable/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(state.load).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Ana Driver")).toBeInTheDocument();
  });
});
