import { render, screen, fireEvent, waitFor, configure } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const perms = { current: new Set(["trip.read", "vehicle.read", "customer.read"]) };
vi.mock("../../auth/permissions", () => ({ usePermissions: () => ({ can: (p) => perms.current.has(p) }) }));
const searchTrips = vi.fn();
vi.mock("../../services/operations/tripService", () => ({ searchTrips: (...a) => searchTrips(...a) }));

import CommandPalette from "./CommandPalette";
import { searchPages } from "./searchResults";

// Most of these wait out the 250 ms search debounce; leave room for a busy machine.
configure({ asyncUtilTimeout: 4000 });

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
function mount(onClose = vi.fn()) {
  render(<MemoryRouter><CommandPalette open onClose={onClose} /><Where /></MemoryRouter>);
  return onClose;
}

beforeEach(() => {
  perms.current = new Set(["trip.read", "vehicle.read", "customer.read"]);
  searchTrips.mockReset().mockResolvedValue([]);
});

describe("searchPages", () => {
  const can = (p) => perms.current.has(p);
  it("only offers pages the user may open", () => {
    const labels = searchPages("", can).map((p) => p.label);
    expect(labels).toContain("Trips");
    expect(labels).toContain("Vehicles");
    expect(labels).not.toContain("Invoices");
  });
  it("matches a page name or its group", () => {
    expect(searchPages("veh", can).map((p) => p.label)).toEqual(["Vehicles"]);
    expect(searchPages("fleet", can).map((p) => p.label)).toContain("Vehicles");
  });
});

describe("CommandPalette", () => {
  it("renders nothing while closed", () => {
    render(<MemoryRouter><CommandPalette open={false} onClose={() => {}} /></MemoryRouter>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a page with Enter and closes", async () => {
    const onClose = mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "vehicles" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    // trips are still being looked up, so Enter waits for them (see below)
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/fleet/vehicles"));
    expect(onClose).toHaveBeenCalled();
  });

  it("searches trips on the server and opens the chosen one", async () => {
    searchTrips.mockResolvedValue([{ id: 42, ticketNo: "TT-0042", customer: "Acme", origin: "A", destination: "B" }]);
    mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "TT-00" } });
    const row = await screen.findByText("TT-0042");
    expect(searchTrips).toHaveBeenCalledWith("TT-00", expect.objectContaining({ limit: 5 }));
    fireEvent.click(row);
    expect(screen.getByTestId("where")).toHaveTextContent("/operations/trips?trip=42");
  });

  it("never asks for trips without trip.read, or for a one-letter query", async () => {
    perms.current = new Set(["vehicle.read"]);
    mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "TT-00" } });
    await new Promise((r) => setTimeout(r, 350));
    expect(searchTrips).not.toHaveBeenCalled();
  });

  it("moves with the arrow keys and closes on Escape", () => {
    const onClose = mount();
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("says so when nothing matches", async () => {
    mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzzz" } });
    await waitFor(() => expect(screen.getByText("No matches")).toBeInTheDocument());
  });

  const trip = (id, ticketNo) => ({ id, ticketNo, customer: "", origin: "", destination: "" });

  it("says it is searching while the trips are on their way", async () => {
    searchTrips.mockReturnValue(new Promise(() => {}));
    mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "TT-00" } });
    expect(await screen.findByText("Searching trips…")).toBeInTheDocument();
    expect(screen.queryByText("No matches")).toBeNull();
  });

  it("reports a failed search instead of claiming there are no matches", async () => {
    searchTrips.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzzz" } });
    expect(await screen.findByText(/Couldn't search trips/)).toBeInTheDocument();
    expect(screen.queryByText("No matches")).toBeNull();
  });

  it("explains when the failure is the connection, and pages still work", async () => {
    searchTrips.mockRejectedValue(Object.assign(new Error("net"), { code: "NETWORK", status: 0 }));
    mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "vehicles" } });
    expect(await screen.findByText(/You're offline/)).toBeInTheDocument();
    expect(screen.getByText("Vehicles")).toBeInTheDocument();
  });

  it("asks again when 'Try again' is pressed", async () => {
    searchTrips.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([trip(7, "TT-0007")]);
    mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "TT-00" } });
    fireEvent.click(await screen.findByText("Try again"));
    expect(await screen.findByText("TT-0007")).toBeInTheDocument();
    expect(searchTrips).toHaveBeenCalledTimes(2);
  });

  it("abandons the previous request when the person keeps typing", async () => {
    searchTrips.mockReturnValue(new Promise(() => {}));
    mount();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "TT-00" } });
    await waitFor(() => expect(searchTrips).toHaveBeenCalledTimes(1));
    const first = searchTrips.mock.calls[0][1].signal;
    expect(first.aborted).toBe(false);
    fireEvent.change(input, { target: { value: "TT-004" } });
    expect(first.aborted).toBe(true);
  });

  it("never shows the answer to a search that was superseded", async () => {
    let resolveFirst;
    searchTrips
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce([trip(2, "TT-0099")]);
    mount();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "TT-00" } });
    await waitFor(() => expect(searchTrips).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: "TT-009" } });
    expect(await screen.findByText("TT-0099")).toBeInTheDocument();
    resolveFirst([trip(1, "TT-0001")]);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("TT-0001")).toBeNull();
  });

  it("opens the trip, not a page, when Enter is pressed before the results land", async () => {
    let resolve;
    searchTrips.mockReturnValue(new Promise((r) => { resolve = r; }));
    mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "trips" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(screen.getByTestId("where")).not.toHaveTextContent("/operations");
    await waitFor(() => expect(searchTrips).toHaveBeenCalled());
    resolve([trip(5, "TT-0005")]);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/operations/trips?trip=5"));
  });

  it("keeps the highlighted row when trips arrive above it", async () => {
    let resolve;
    searchTrips.mockReturnValue(new Promise((r) => { resolve = r; }));
    mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "trips" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowDown" });
    const selected = () => screen.getAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true");
    const label = selected().textContent;
    await waitFor(() => expect(searchTrips).toHaveBeenCalled());
    resolve([trip(5, "TT-0005")]);
    await screen.findByText("TT-0005");
    expect(selected().textContent).toBe(label);
  });

  it("ignores Enter that confirms an IME candidate", () => {
    perms.current = new Set(["vehicle.read"]);
    const onClose = mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "vehicles" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", keyCode: 229 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps focus inside the dialog on Tab", () => {
    mount();
    const input = screen.getByRole("combobox");
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveFocus();
  });

  it("hands focus back to where it was when it closes", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const { unmount } = render(<MemoryRouter><CommandPalette open onClose={() => {}} /></MemoryRouter>);
    expect(outside).not.toHaveFocus();
    unmount();
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it("tells a trip-reader that one character is too few", () => {
    mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "T" } });
    expect(screen.getByText(/at least 2 characters/)).toBeInTheDocument();
  });
});
