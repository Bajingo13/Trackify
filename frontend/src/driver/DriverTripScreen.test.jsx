import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  trip: vi.fn(),
  ping: vi.fn(),
  start: vi.fn(),
  deliver: vi.fn(),
  arrive: vi.fn(),
  startTracking: vi.fn(),
  stopTracking: vi.fn(),
  onFix: null,
  queue: { total: 0, pings: 0, records: 0 },
}));

vi.mock("./driverApi", () => ({
  currentDriverId: () => 7,
  driverTrip: (...args) => state.trip(...args),
  driverPing: (...args) => state.ping(...args),
  driverStart: (...args) => state.start(...args),
  driverDeliver: (...args) => state.deliver(...args),
  driverUnread: () => Promise.resolve([]),
  driverArriveAtStop: (...args) => state.arrive(...args),
}));

vi.mock("./tracking", () => ({
  startTracking: (...args) => state.startTracking(...args),
  stopTracking: (...args) => state.stopTracking(...args),
  tracksInBackground: () => true,
  openLocationSettings: vi.fn(),
}));

vi.mock("./offlineQueue", () => ({
  pendingCount: () => Promise.resolve({ ...state.queue }),
  onQueueChange: () => () => {},
}));

vi.mock("./capabilities", () => ({
  canShareLocation: () => true,
  isInsecureLan: () => false,
}));
vi.mock("./native", () => ({ tap: vi.fn(), notifySuccess: vi.fn() }));
vi.mock("./DriverExpenses", () => ({ default: () => null }));
vi.mock("./DeliverySheet", () => ({
  default: ({ arrived, onCancel }) => (
    <div>
      <span>{arrived ? "delivery sheet (arrived)" : "delivery sheet"}</span>
      <button type="button" onClick={onCancel}>cancel sheet</button>
    </div>
  ),
}));
vi.mock("./DriverStops", () => ({ default: () => null }));
vi.mock("./OfflineBar", () => ({ default: () => null }));
vi.mock("./CapabilityNotice", () => ({ default: () => null }));
vi.mock("./VehiclePhoto", () => ({ default: () => null }));
// Only the progress rail is stubbed; the formatters and the route timeline are the real ones.
vi.mock("./DriverBits", async (importOriginal) => ({ ...(await importOriginal()), TripTrack: () => null }));
vi.mock("../components/map/MapView", () => ({ default: () => null }));

import DriverTripScreen from "./DriverTripScreen";

const trip = (status) => ({
  id: 41,
  ticketNo: "TRIP-0041",
  customer: "Test Customer",
  status,
  stops: [],
  origin: "Davao City",
  destination: "Tagum City",
  originLat: null,
  destLat: null,
});

describe("driver trip location sharing", () => {
  beforeEach(() => {
    state.trip.mockReset().mockResolvedValue(trip("released"));
    state.ping.mockReset().mockResolvedValue({ data: {} });
    state.start.mockReset().mockResolvedValue({ data: {} });
    state.deliver.mockReset().mockResolvedValue({ data: {} });
    state.stopTracking.mockReset().mockResolvedValue(undefined);
    state.queue = { total: 0, pings: 0, records: 0 };
    state.onFix = null;
    state.startTracking.mockReset().mockImplementation(async (onFix) => {
      state.onFix = onFix;
      return true;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function startSharing() {
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    fireEvent.click(screen.getByRole("button", { name: "Toggle location sharing" }));
    await waitFor(() => expect(state.startTracking).toHaveBeenCalledTimes(1));
  }

  it("labels a network-failed ping as saved instead of sent", async () => {
    state.ping.mockImplementation(async () => {
      state.queue = { total: 1, pings: 1, records: 0 };
      return { queued: true };
    });
    await startSharing();

    await act(async () => {
      await state.onFix({ lat: 7.07, lng: 125.61, accuracyMeters: 12 });
    });

    // Calling a queued position "sent" leaves a driver believing dispatch can
    // see them during an API outage, which is exactly when that distinction matters.
    expect(screen.getByText("1 location update saved on this phone")).toBeInTheDocument();
    expect(screen.queryByText(/^Sent /)).not.toBeInTheDocument();
  });

  it("stops the watcher when the authoritative trip status is no longer active", async () => {
    state.trip
      .mockReset()
      .mockResolvedValueOnce(trip("released"))
      .mockResolvedValueOnce(trip("delivered"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await startSharing();
    state.stopTracking.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Start trip" }));

    await screen.findByText("Delivered. Thanks!");
    await waitFor(() => expect(state.stopTracking).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Toggle location sharing" })).not.toBeInTheDocument();
  });

  it("heartbeats the last good fix while the truck is stationary", async () => {
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "Toggle location sharing" }));
    await act(async () => { await Promise.resolve(); });

    const fix = { lat: 7.07, lng: 125.61, accuracyMeters: 12 };
    await act(async () => { await state.onFix(fix); });
    expect(state.ping).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1); });
    expect(state.ping).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(state.ping).toHaveBeenCalledTimes(2);
    expect(state.ping).toHaveBeenLastCalledWith(41, fix);
  });
});

describe("the active route", () => {
  const withMap = (status, stops = [
    { id: 7, label: "Redwood Cold Storage, Davao City", lat: 7.1, lng: 125.6, arrivedAt: "2026-08-29T02:00:00Z" },
    { id: 8, label: "Tagum Hub, Tagum City", lat: 7.4, lng: 125.8, arrivedAt: null },
  ]) => ({
    ...trip(status), originLat: 7.07, originLng: 125.6, destLat: 7.5, destLng: 125.9, stops,
    routeKm: 30.95, routeMin: 43, scheduledArrival: "2026-08-29T13:00:00",
  });

  beforeEach(() => {
    state.trip.mockReset();
    state.arrive.mockReset().mockResolvedValue({ data: {} });
    state.start.mockReset().mockResolvedValue({ data: {} });
    state.startTracking.mockReset().mockResolvedValue(true);
  });

  it("is reached from the load details, and back goes to the details, not out of the trip", async () => {
    state.trip.mockResolvedValue(withMap("in_transit"));
    const onBack = vi.fn();
    render(<DriverTripScreen tripId={41} onBack={onBack} />);
    await screen.findByText("TRIP-0041");
    expect(screen.queryByText("Active route")).toBeNull();
    // delivery lives on the route screen this button opens, so it is not offered twice
    expect(screen.queryByRole("button", { name: /delivered/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open route" }));
    expect(await screen.findByText("Active route")).toBeInTheDocument();
    // named in the bar over the map and again on the stop card under it
    expect(screen.getAllByText("Tagum Hub")).toHaveLength(2);
    expect(screen.getByText("Stop 2 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to load details" }));
    expect(await screen.findByRole("button", { name: "Back to my trips" })).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("folds the panel down to its header and the delivery buttons, and opens it again", async () => {
    state.trip.mockResolvedValue(withMap("in_transit"));
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    fireEvent.click(screen.getByRole("button", { name: "Open route" }));

    const header = await screen.findByRole("button", { name: /Next stop/ });
    // open: the address, the plan and the location control are all there
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Tagum Hub, Tagum City")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle location sharing" })).toBeInTheDocument();
    expect(screen.getByText("Est. time")).toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Tagum Hub, Tagum City")).toBeNull();
    expect(screen.queryByRole("button", { name: "Toggle location sharing" })).toBeNull();
    expect(screen.queryByText("Est. time")).toBeNull();
    // what the driver acts with stays put
    expect(screen.getByRole("button", { name: /delivered/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arrived at stop" })).toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.getByRole("button", { name: "Toggle location sharing" })).toBeInTheDocument();
  });

  it("never folds an error away", async () => {
    state.trip.mockResolvedValue(withMap("in_transit"));
    state.arrive.mockRejectedValue(new Error("Could not record that stop."));
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    fireEvent.click(screen.getByRole("button", { name: "Open route" }));
    fireEvent.click(await screen.findByRole("button", { name: "Arrived at stop" }));
    await screen.findByText("Could not record that stop.");
    fireEvent.click(screen.getByRole("button", { name: /Next stop/ })); // fold it
    expect(screen.getByText("Could not record that stop.")).toBeInTheDocument();
  });

  it("records the next stop as reached, against that stop", async () => {
    state.trip.mockResolvedValue(withMap("in_transit"));
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    fireEvent.click(screen.getByRole("button", { name: "Open route" }));
    fireEvent.click(await screen.findByRole("button", { name: "Arrived at stop" }));
    await waitFor(() => expect(state.arrive).toHaveBeenCalledTimes(1));
    expect(state.arrive.mock.calls[0].slice(0, 2)).toEqual([41, 8]);
  });

  it("offers only delivery once every stop is reached", async () => {
    state.trip.mockResolvedValue(withMap("in_transit", [
      { id: 7, label: "A, X", lat: 7.1, lng: 125.6, arrivedAt: "2026-08-29T02:00:00Z" },
    ]));
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    fireEvent.click(screen.getByRole("button", { name: "Open route" }));
    expect(await screen.findByRole("button", { name: /delivered/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Arrived at stop" })).toBeNull();
    expect(screen.getByText("Final stop")).toBeInTheDocument();
  });

  it("goes straight to the road when the trip is started", async () => {
    state.trip
      .mockResolvedValueOnce(withMap("released"))
      .mockResolvedValue(withMap("in_transit"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    fireEvent.click(screen.getByRole("button", { name: "Start trip" }));
    expect(await screen.findByText("Active route")).toBeInTheDocument();
  });

  it("keeps delivery on the details when the run has no map to open", async () => {
    state.trip.mockResolvedValue(trip("in_transit"));
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    expect(screen.getByRole("button", { name: /delivered/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open route" })).toBeNull();
  });
});

describe("arriving at the drop-off", () => {
  let n = 900;
  const nearTrip = (id) => ({
    ...trip("in_transit"), id,
    originLat: 7.07, originLng: 125.6, destLat: 7.5, destLng: 125.9, stops: [],
  });
  const FAR = { lat: 7.07, lng: 125.6, accuracyMeters: 10 };
  const NEAR = { lat: 7.5005, lng: 125.9005, accuracyMeters: 10 }; // about 75 m from the pin

  async function open(id = (n += 1)) {
    state.trip.mockReset().mockResolvedValue(nearTrip(id));
    state.startTracking.mockReset().mockImplementation(async (onFix) => { state.onFix = onFix; return true; });
    render(<DriverTripScreen tripId={id} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    fireEvent.click(screen.getByRole("button", { name: "Toggle location sharing" }));
    await waitFor(() => expect(state.startTracking).toHaveBeenCalled());
  }
  const fix = (f) => act(async () => { await state.onFix(f); });

  it("says nothing while the truck is still far from the pin", async () => {
    await open();
    await fix(FAR);
    expect(screen.queryByText("You\u2019ve arrived")).toBeNull();
    expect(screen.queryByText(/delivery sheet/)).toBeNull();
  });

  it("announces the arrival and opens proof of delivery at once", async () => {
    await open();
    await fix(FAR);
    await fix(NEAR);
    expect(await screen.findByText("You\u2019ve arrived")).toBeInTheDocument();
    expect(screen.getByText("delivery sheet (arrived)")).toBeInTheDocument();
  });

  it("does not open the form again once the driver has put it away", async () => {
    await open();
    await fix(NEAR);
    await screen.findByText("delivery sheet (arrived)");

    fireEvent.click(screen.getByRole("button", { name: "cancel sheet" }));
    expect(screen.queryByText(/delivery sheet/)).toBeNull();
    await fix(NEAR);
    await fix({ ...NEAR, lat: 7.5006 });
    expect(screen.queryByText(/delivery sheet/)).toBeNull();

    // the notice stays, and brings the form back on request
    fireEvent.click(screen.getByRole("button", { name: "Confirm delivery" }));
    expect(screen.getByText("delivery sheet (arrived)")).toBeInTheDocument();
  });

  it("never fires for a run that is not on the road", async () => {
    state.trip.mockReset().mockResolvedValue({ ...nearTrip(777), status: "released" });
    state.startTracking.mockReset().mockImplementation(async (onFix) => { state.onFix = onFix; return true; });
    render(<DriverTripScreen tripId={777} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    fireEvent.click(screen.getByRole("button", { name: "Toggle location sharing" }));
    await waitFor(() => expect(state.startTracking).toHaveBeenCalled());
    await fix(NEAR);
    expect(screen.queryByText("You\u2019ve arrived")).toBeNull();
  });
});
