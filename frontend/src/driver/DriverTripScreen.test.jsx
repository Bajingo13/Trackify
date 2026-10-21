import { act, cleanup as cleanupScreen, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./netStatus", () => import("./netStatus.mock"));

const state = vi.hoisted(() => ({
  trip: vi.fn(),
  ping: vi.fn(),
  start: vi.fn(),
  deliver: vi.fn(),
  arrive: vi.fn(),
  pause: vi.fn(),
  pauseResume: vi.fn(),
  pauseWithdraw: vi.fn(),
  trail: vi.fn(),
  mapProps: null,
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
  // no pause unless a test sets one
  driverPauseActive: (...args) => Promise.resolve(state.pause(...args) ?? null),
  driverPauseResume: (...args) => Promise.resolve(state.pauseResume(...args)),
  driverPauseWithdraw: (...args) => Promise.resolve(state.pauseWithdraw(...args)),
  driverTripTrail: (...args) => state.trail(...args),
}));

vi.mock("./tracking", () => ({
  startTracking: (...args) => state.startTracking(...args),
  stopTracking: (...args) => state.stopTracking(...args),
  tracksInBackground: () => true,
  openLocationSettings: vi.fn(),
  PERMISSION_OFF: "permission off",
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
// The card itself is tested on its own; here it only reports how the screen drives it.
vi.mock("./DriverExpenses", () => ({
  default: (props) => (
    <div data-testid="expenses" data-filing={String(Boolean(props.filing))} data-compact={String(Boolean(props.compact))} />
  ),
}));
vi.mock("./DeliverySheet", () => ({
  default: ({ arrived, onCancel, onConfirm }) => (
    <div>
      <span>{arrived ? "delivery sheet (arrived)" : "delivery sheet"}</span>
      <button type="button" onClick={onCancel}>cancel sheet</button>
      <button type="button" onClick={() => onConfirm({})}>confirm sheet</button>
    </div>
  ),
}));
vi.mock("./DriverStops", () => ({ default: () => null }));
vi.mock("./OfflineBar", () => ({ default: () => null }));
vi.mock("./CapabilityNotice", () => ({ default: () => null }));
vi.mock("./VehiclePhoto", () => ({ default: () => null }));
// Only the progress rail is stubbed; the formatters and the route timeline are the real ones.
vi.mock("./DriverBits", async (importOriginal) => ({ ...(await importOriginal()), TripTrack: () => null }));
// draws nothing; keeps what it was asked to draw, for the tests that look at the lines
vi.mock("../components/map/MapView", () => ({ default: (props) => { state.mapProps = props; return null; } }));

import DriverTripScreen from "./DriverTripScreen";
import { getLocationSession, resetLocationSessionForTests } from "./locationSession";
import { clearTripCache, saveTrip } from "./tripCache";
import { setNet } from "./netStatus";

// Sharing is app-wide module state now; every test starts from none.
beforeEach(() => {
  resetLocationSessionForTests();
  localStorage.clear();
});

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

  it("covers the screen with the loader while a status change goes through, then lets go", async () => {
    let finish;
    state.start.mockReset().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    state.trip.mockReset().mockResolvedValue(trip("released"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    // opening the screen is navigation, not a status change
    expect(screen.queryByRole("status", { name: /Starting/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Start trip" }));
    expect(await screen.findByRole("status", { name: "Starting your trip" })).toBeInTheDocument();

    await act(async () => { finish({ data: {} }); });
    // held a moment past the response so a fast request does not flash
    await waitFor(() => expect(screen.queryByRole("status", { name: /Starting/ })).toBeNull(), { timeout: 3000 });
  });

  it("keeps sharing when the driver leaves the trip screen, and shows it on again on return", async () => {
    await startSharing();
    state.stopTracking.mockClear();
    // back to the trip list: the trip screen closes
    cleanupScreen();
    expect(state.stopTracking).not.toHaveBeenCalled();
    expect(getLocationSession()).toMatchObject({ tripId: 41, sharing: true });

    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    expect(screen.getByRole("button", { name: "Toggle location sharing" })).toHaveAttribute("aria-pressed", "true");
    expect(state.startTracking).toHaveBeenCalledTimes(1);
  });

  it("stops only when the driver turns it off", async () => {
    await startSharing();
    state.stopTracking.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Toggle location sharing" }));
    await waitFor(() => expect(state.stopTracking).toHaveBeenCalled());
    expect(getLocationSession().sharing).toBe(false);
  });

  it("turns sharing on by itself when the driver starts the trip", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    state.trip.mockReset().mockResolvedValueOnce(trip("released")).mockResolvedValue(trip("in_transit"));
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    fireEvent.click(screen.getByRole("button", { name: "Start trip" }));
    await waitFor(() => expect(state.startTracking).toHaveBeenCalledTimes(1));
    // a button the driver pressed, so the permission may be asked for
    expect(state.startTracking.mock.calls[0][2]).toEqual({ requestPermissions: true });
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
    state.pause.mockReset();
    state.pauseResume.mockReset();
    state.pauseWithdraw.mockReset();
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

  it("puts Open route and + Expense on one row, and + Expense opens the claim form", async () => {
    state.trip.mockResolvedValue(withMap("in_transit"));
    const { container } = render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");

    const open = screen.getByRole("button", { name: "Open route" });
    const add = screen.getByRole("button", { name: "Add an expense" });
    // one row: both are children of the same pair, the main action first and wider
    expect(open.parentElement).toBe(add.parentElement);
    expect(open.parentElement).toHaveClass("dr-action-pair");
    expect(open.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(open).not.toHaveClass("ghost");
    expect(add).toHaveClass("ghost");
    expect(add).toHaveTextContent("+ Expense");

    // the card below keeps the list, with a small link instead of its big button
    expect(screen.getByTestId("expenses")).toHaveAttribute("data-compact", "true");
    expect(screen.getByTestId("expenses")).toHaveAttribute("data-filing", "false");
    fireEvent.click(add);
    expect(screen.getByTestId("expenses")).toHaveAttribute("data-filing", "true");
    expect(container.querySelectorAll(".dr-action-pair")).toHaveLength(1);
  });

  it("offers no + Expense before the truck is released, so Open route has the row to itself", async () => {
    state.trip.mockResolvedValue(withMap("assigned"));
    const { container } = render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    expect(screen.queryByRole("button", { name: "Add an expense" })).toBeNull();
    expect(container.querySelector(".dr-action-pair")).toBeNull();
    expect(screen.queryByTestId("expenses")).toBeNull();
  });

  it("keeps the expense card's own button when there is no map to put a row under", async () => {
    state.trip.mockResolvedValue(trip("in_transit"));
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    expect(screen.queryByRole("button", { name: "Add an expense" })).toBeNull();
    expect(screen.getByTestId("expenses")).toHaveAttribute("data-compact", "false");
  });

  it("offers to report a problem on a run that is on the road, and opens Help with this run chosen", async () => {
    state.trip.mockResolvedValue(withMap("in_transit"));
    const onHelp = vi.fn();
    render(<DriverTripScreen tripId={41} onBack={() => {}} onHelp={onHelp} />);
    await screen.findByText("TRIP-0041");
    expect(screen.getByText("Something wrong on the road?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
    expect(onHelp).toHaveBeenCalledWith({ pause: true, tripId: 41 });
  });

  it("does not offer it before the truck is on the road", async () => {
    state.trip.mockResolvedValue(withMap("assigned"));
    render(<DriverTripScreen tripId={41} onBack={() => {}} onHelp={() => {}} />);
    await screen.findByText("TRIP-0041");
    expect(screen.queryByText("Something wrong on the road?")).toBeNull();
  });

  it("says a pause request is waiting, and lets the driver withdraw it", async () => {
    state.trip.mockResolvedValue(withMap("in_transit"));
    state.pause.mockReturnValue({ id: 7, status: "pending", reason: "breakdown", ticketId: 9 });
    const onHelp = vi.fn();
    render(<DriverTripScreen tripId={41} onBack={() => {}} onHelp={onHelp} />);

    // the banner, not the trip's loader (also a status) or the status pill
    const banner = (await screen.findByText("Pause requested", { selector: ".dr-pause-banner-title" })).closest("[role=\"status\"]");
    expect(banner).toHaveTextContent("Pause requested");
    expect(banner).toHaveTextContent("waiting for the office");
    // a pause is already on, so the way to start another is not offered
    expect(screen.queryByText("Something wrong on the road?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume delivery" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View request" }));
    expect(onHelp).toHaveBeenCalledWith({ ticketId: 9 });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(state.pauseWithdraw).toHaveBeenCalledWith(41));
  });

  it("shows no banner once the pause is approved: the Paused button says it", async () => {
    state.trip.mockResolvedValue(withMap("in_transit"));
    state.pause.mockReturnValue({ id: 7, status: "approved", reason: "delay", ticketId: 9 });
    render(<DriverTripScreen tripId={41} onBack={() => {}} onHelp={() => {}} />);
    await screen.findByText("TRIP-0041");
    await waitFor(() => expect(state.pause).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Delivery paused")).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume delivery" })).toBeNull();
  });

  it("swaps I've delivered for Paused while the pause is approved, and tapping it resumes", async () => {
    state.trip.mockResolvedValue(withMap("in_transit"));
    state.pause.mockReturnValue({ id: 7, status: "approved", reason: "breakdown", ticketId: 9 });
    render(<DriverTripScreen tripId={41} onBack={() => {}} onHelp={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open route" }));
    await screen.findByText("Active route");

    const paused = await screen.findByRole("button", { name: /^Paused/ });
    expect(screen.queryByRole("button", { name: /delivered/ })).toBeNull();
    fireEvent.click(paused);
    await waitFor(() => expect(state.pauseResume).toHaveBeenCalledWith(41));
  });

  it("keeps I've delivered while the pause is only requested", async () => {
    state.trip.mockResolvedValue(withMap("in_transit"));
    state.pause.mockReturnValue({ id: 7, status: "pending", reason: "breakdown", ticketId: 9 });
    render(<DriverTripScreen tripId={41} onBack={() => {}} onHelp={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open route" }));
    await screen.findByText("Active route");
    expect(await screen.findByRole("button", { name: /delivered/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Paused/ })).toBeNull();
  });

  it("offers a call to the customer, next to chat, when the customer has a number", async () => {
    state.trip.mockResolvedValue({
      ...withMap("in_transit"), customerContact: "Ana Reyes", customerPhone: "0917 123 4567",
    });
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    // the call sits on the route screen only; the details screen is unchanged
    expect(screen.queryByRole("link", { name: /^Call/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open route" }));
    const call = await screen.findByRole("link", { name: "Call Ana Reyes" });
    expect(call).toHaveAttribute("href", "tel:09171234567");
    expect(screen.getByRole("button", { name: /Chat with dispatch/ })).toBeInTheDocument();
  });

  it("shows no call button when the customer has no usable number", async () => {
    state.trip.mockResolvedValue({ ...withMap("in_transit"), customerContact: "Ana Reyes", customerPhone: "n/a" });
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    fireEvent.click(screen.getByRole("button", { name: "Open route" }));
    await screen.findByText("Active route");
    expect(screen.queryByRole("link", { name: /^Call/ })).toBeNull();
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

describe("a finished run's map", () => {
  const planned = { type: "LineString", coordinates: [[125.6, 7.07], [125.9, 7.5]] };
  const delivered = (status = "delivered") => ({
    ...trip(status), originLat: 7.07, originLng: 125.6, destLat: 7.5, destLng: 125.9,
    routeKm: 30.95, routeMin: 43, routeGeom: planned,
  });
  const trail = {
    points: [
      { lat: 7.07, lng: 125.6, at: "2026-08-29T02:02:00.000Z" },
      { lat: 7.3, lng: 125.7, at: "2026-08-29T03:00:00.000Z" },
      { lat: 7.5, lng: 125.9, at: "2026-08-29T04:41:00.000Z" },
    ],
    snapped: null,
    distanceKm: 31.4,
    startedAt: "2026-08-29T02:02:00.000Z",
    endedAt: "2026-08-29T04:41:00.000Z",
  };

  beforeEach(() => {
    state.trip.mockReset();
    state.pause.mockReset();
    state.trail.mockReset();
    state.mapProps = null;
  });

  async function openMap(status) {
    state.trip.mockResolvedValue(delivered(status));
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    fireEvent.click(screen.getByRole("button", { name: "View map" }));
    expect(await screen.findByText("Route driven")).toBeInTheDocument();
  }

  it("draws the road driven over a faint plan, with what it came to, and nothing to act on", async () => {
    state.trail.mockResolvedValue(trail);
    await openMap("delivered");
    expect(await screen.findByText("Route you drove")).toBeInTheDocument();
    expect(screen.getByText("Planned route")).toBeInTheDocument();
    expect(screen.getByText("31.4 km")).toBeInTheDocument();
    expect(state.trail).toHaveBeenCalledWith(41);

    const lines = Object.fromEntries(state.mapProps.routes.map((r) => [r.id, r]));
    expect(lines.driven.geometry.coordinates).toEqual([[125.6, 7.07], [125.7, 7.3], [125.9, 7.5]]);
    expect(lines.driven.color).toBe("#2563eb");
    expect(lines.planned.color).toBe("#94a3b8");
    // the whole trail is brought into view
    expect(state.mapProps.fitTo).toEqual(expect.arrayContaining([[125.7, 7.3]]));

    // view only: nothing that changes the run
    for (const name of [/delivered/, /Start trip/, /Arrived at stop/, /Toggle location sharing/]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("prefers the road-snapped line when the server has one", async () => {
    const snapped = { type: "LineString", coordinates: [[125.6, 7.07], [125.65, 7.2], [125.9, 7.5]] };
    state.trail.mockResolvedValue({ ...trail, snapped });
    await openMap("operationally_closed");
    await screen.findByText("Route you drove");
    expect(state.mapProps.routes.find((r) => r.id === "driven").geometry).toEqual(snapped);
  });

  it("says so when no route was recorded, and keeps the plan in blue", async () => {
    state.trail.mockResolvedValue({ points: [], snapped: null, distanceKm: 0, startedAt: null, endedAt: null });
    await openMap("delivered");
    expect(await screen.findByText(/No GPS route was recorded for this run/)).toBeInTheDocument();
    expect(state.mapProps.routes).toEqual([expect.objectContaining({ id: "planned", color: "#2563eb" })]);
  });

  it("offers to try again when the trail could not be loaded", async () => {
    state.trail.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(trail);
    await openMap("delivered");
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Route you drove")).toBeInTheDocument();
    expect(state.trail).toHaveBeenCalledTimes(2);
  });

  it("still goes back to the details at the moment the delivery is confirmed", async () => {
    state.deliver.mockReset().mockResolvedValue({ data: {} });
    state.stopTracking.mockReset().mockResolvedValue(undefined);
    state.trip.mockResolvedValueOnce(delivered("in_transit")).mockResolvedValue(delivered("delivered"));
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    fireEvent.click(screen.getByRole("button", { name: "Open route" }));
    await screen.findByText("Active route");
    fireEvent.click(screen.getByRole("button", { name: /I.ve delivered/ }));
    fireEvent.click(screen.getByRole("button", { name: "confirm sheet" }));
    expect(await screen.findByRole("button", { name: "View map" })).toBeInTheDocument();
    expect(screen.queryByText("Route driven")).toBeNull();
    expect(state.trail).not.toHaveBeenCalled();
  });

  it("does not ask for a trail on a run still on the road, or before the map is opened", async () => {
    state.trail.mockResolvedValue(trail);
    state.trip.mockResolvedValue(delivered("delivered"));
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    expect(state.trail).not.toHaveBeenCalled();
    cleanupScreen();

    state.trip.mockResolvedValue(delivered("in_transit"));
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    fireEvent.click(screen.getByRole("button", { name: "Open route" }));
    expect(await screen.findByText("Active route")).toBeInTheDocument();
    expect(state.trail).not.toHaveBeenCalled();
  });
});

describe("the route without signal", () => {
  const noSignal = () => Promise.reject(new TypeError("Failed to fetch"));
  beforeEach(async () => {
    await clearTripCache(7);
    setNet("online");
    state.pause.mockReset();
  });

  it("opens the copy kept on the phone, and says it is a copy", async () => {
    await saveTrip(7, trip("in_transit"));
    state.trip.mockReset().mockImplementation(noSignal);
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    expect(await screen.findByText("TRIP-0041")).toBeInTheDocument();
    expect(screen.getByText(/Saved copy/)).toBeInTheDocument();
  });

  it("explains, without a copy, that the trip loads once back online", async () => {
    state.trip.mockReset().mockImplementation(noSignal);
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    expect(await screen.findByText(/has not been opened on this phone before/)).toBeInTheDocument();
  });

  it("clears the no-internet message once the trip does load", async () => {
    state.trip.mockReset().mockImplementationOnce(noSignal).mockResolvedValue(trip("in_transit"));
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText(/has not been opened on this phone before/);
    setNet("offline");
    setNet("online");
    expect(await screen.findByText("TRIP-0041")).toBeInTheDocument();
    expect(screen.queryByText(/has not been opened on this phone before/)).toBeNull();
  });

  it("tries again when a blip only ever marked the link unstable", async () => {
    state.trip.mockReset().mockImplementationOnce(noSignal).mockResolvedValue(trip("in_transit"));
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText(/has not been opened on this phone before/);
    setNet("unstable");
    setNet("online");
    expect(await screen.findByText("TRIP-0041")).toBeInTheDocument();
  });

  it("keeps the trip on screen when a refresh fails, with no error over the route", async () => {
    state.trip.mockReset().mockResolvedValueOnce(trip("in_transit")).mockImplementation(noSignal);
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText("TRIP-0041");
    setNet("offline");
    setNet("online"); // reloads, and this time the network fails
    await waitFor(() => expect(state.trip).toHaveBeenCalledTimes(2));
    expect(screen.getByText("TRIP-0041")).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
  });

  it("swaps the copy for the trip from the server as soon as the internet is back", async () => {
    await saveTrip(7, trip("in_transit"));
    state.trip.mockReset().mockImplementationOnce(noSignal).mockResolvedValue(trip("in_transit"));
    render(<DriverTripScreen tripId={41} onBack={() => {}} />);
    await screen.findByText(/Saved copy/);
    setNet("offline");
    setNet("online");
    await waitFor(() => expect(screen.queryByText(/Saved copy/)).toBeNull());
  });
});
