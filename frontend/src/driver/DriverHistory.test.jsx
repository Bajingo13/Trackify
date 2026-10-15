import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ runs: [], totals: { trips: 5, km: 228 }, trip: {} }));

vi.mock("./driverApi", () => ({
  driverHistory: () => Promise.resolve(state.runs),
  driverMe: () => Promise.resolve({ totals: state.totals }),
  driverTrip: () => Promise.resolve(state.trip),
}));

const { default: DriverHistory, filterRuns } = await import("./DriverHistory");
const { default: DriverRunDetail } = await import("./DriverRunDetail");

const run = (id, extra = {}) => ({
  id, ticketNo: `TT-000${id}`, status: "operationally_closed", origin: "Makati, Metro Manila", destination: "Cavite",
  routeKm: 45, scheduledDeparture: "2026-09-18T01:00:00Z", finishedAt: "2026-09-18T07:30:00Z",
  customer: "ABC Corp", vehicle: "ABC 1234", vehicleType: "Closed Van", receivedBy: null, deliveredAt: null, ...extra,
});

describe("History", () => {
  beforeEach(() => {
    state.runs = [
      run(3, { destination: "Pasay", status: "delivered" }),
      run(2, { vehicle: "CEB 2001", finishedAt: "2026-08-20T07:30:00Z" }),
      run(1, { status: "cancelled", destination: "Tagum", finishedAt: "2026-08-02T07:30:00Z" }),
    ];
    state.totals = { trips: 5, km: 228 };
    state.trip = {};
  });

  it("leads with the server's own totals and groups the runs by month", async () => {
    render(<DriverHistory detail={null} onDetail={() => {}} />);
    expect(await screen.findByText("Completed runs")).toBeInTheDocument();
    expect(screen.getByText("228")).toBeInTheDocument();
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    expect(screen.getByText("August 2026")).toBeInTheDocument();
  });

  it("leaves the totals out rather than showing zero when they cannot be loaded", async () => {
    state.totals = undefined;
    render(<DriverHistory detail={null} onDetail={() => {}} />);
    await screen.findByText("September 2026");
    expect(screen.queryByText("Completed runs")).toBeNull();
  });

  it("searches by run, place and vehicle, and says when nothing matches", async () => {
    render(<DriverHistory detail={null} onDetail={() => {}} />);
    await screen.findByText("September 2026");
    const box = screen.getByLabelText("Search your finished runs");

    fireEvent.change(box, { target: { value: "pasay" } });
    expect(screen.getByText("TT-0003")).toBeInTheDocument();
    expect(screen.queryByText("TT-0002")).toBeNull();

    fireEvent.change(box, { target: { value: "ceb 2001" } });
    expect(screen.getByText("TT-0002")).toBeInTheDocument();
    expect(screen.queryByText("TT-0003")).toBeNull();

    fireEvent.change(box, { target: { value: "nowhere" } });
    expect(screen.getByText("No runs match")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(screen.getByText("TT-0003")).toBeInTheDocument();
  });

  it("filters by status, offering only statuses that are actually in the list", async () => {
    render(<DriverHistory detail={null} onDetail={() => {}} />);
    await screen.findByText("September 2026");
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.queryByRole("button", { name: "Returned" })).toBeNull();
    const statusChoices = screen.getByRole("group", { name: "Run status" });
    expect(statusChoices).toHaveClass("dr-chiprow-scroll");
    expect([...statusChoices.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "All", "Closed", "Cancelled", "Delivered",
    ]);
    expect(screen.getByLabelText("From")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("To")).toHaveAttribute("type", "date");

    fireEvent.click(screen.getByRole("button", { name: "Cancelled" }));
    expect(screen.getByText("TT-0001")).toBeInTheDocument();
    expect(screen.queryByText("TT-0002")).toBeNull();
    expect(screen.getByRole("button", { name: /Filters, 1 active/ })).toBeInTheDocument();
  });

  it("opens a run when its row is tapped", async () => {
    const onDetail = vi.fn();
    render(<DriverHistory detail={null} onDetail={onDetail} />);
    fireEvent.click(await screen.findByRole("button", { name: /TT-0003, Delivered/ }));
    expect(onDetail).toHaveBeenCalledWith({ run: expect.objectContaining({ id: 3 }) });
  });

  it("says plainly when there is nothing yet", async () => {
    state.runs = [];
    render(<DriverHistory detail={null} onDetail={() => {}} />);
    expect(await screen.findByText("No finished runs yet")).toBeInTheDocument();
  });
});

describe("the date range", () => {
  const runs = [run(1, { finishedAt: "2026-09-10T08:00:00" }), run(2, { finishedAt: "2026-09-20T08:00:00" }), run(3, { finishedAt: null, scheduledDeparture: null })];
  const ids = (f) => filterRuns(runs, f).map((r) => r.id);

  it("includes both end days, and drops runs with no date when a range is set", () => {
    expect(ids({ from: "2026-09-10", to: "2026-09-10" })).toEqual([1]);
    expect(ids({ from: "2026-09-11" })).toEqual([2]);
    expect(ids({ to: "2026-09-15" })).toEqual([1]);
    expect(ids({})).toEqual([1, 2, 3]);
  });
});

describe("a finished run's detail", () => {
  it("shows the delivery record only when somebody signed for the drop", async () => {
    state.trip = { cargo: "Office Supplies", stops: [], instructions: "Leave at reception" };
    render(<DriverRunDetail run={run(7, { status: "delivered", receivedBy: "Maria Santos", deliveredAt: "2026-09-18T07:00:00Z" })} onBack={() => {}} />);
    expect(screen.getByText("Delivery record")).toBeInTheDocument();
    expect(screen.getByText("Maria Santos")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Office Supplies")).toBeInTheDocument());
    expect(screen.getByText("Leave at reception")).toBeInTheDocument();
  });

  it("says a cancelled run was cancelled, with no delivery record and no invented reason", () => {
    render(<DriverRunDetail run={run(8, { status: "cancelled", receivedBy: "Maria Santos" })} onBack={() => {}} />);
    expect(screen.getByText("This run was cancelled.")).toBeInTheDocument();
    expect(screen.queryByText("Delivery record")).toBeNull();
    expect(screen.queryByText(/reason/i)).toBeNull();
  });

  it("goes back", () => {
    const onBack = vi.fn();
    render(<DriverRunDetail run={run(9)} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });
});
