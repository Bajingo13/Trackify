import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  trip: vi.fn(),
  ping: vi.fn(),
  start: vi.fn(),
  deliver: vi.fn(),
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
vi.mock("./DeliverySheet", () => ({ default: () => null }));
vi.mock("./DriverStops", () => ({ default: () => null }));
vi.mock("./OfflineBar", () => ({ default: () => null }));
vi.mock("./CapabilityNotice", () => ({ default: () => null }));
vi.mock("./VehiclePhoto", () => ({ default: () => null }));
vi.mock("./DriverBits", () => ({ TripTrack: () => null }));
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
