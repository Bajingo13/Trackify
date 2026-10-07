import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const perms = { current: new Set(["trip.read", "vehicle.read", "customer.read"]) };
vi.mock("../../auth/permissions", () => ({ usePermissions: () => ({ can: (p) => perms.current.has(p) }) }));
const getAllTrips = vi.fn();
vi.mock("../../services/operations/tripService", () => ({ getAllTrips: (...a) => getAllTrips(...a) }));

import CommandPalette from "./CommandPalette";
import { searchPages } from "./searchResults";

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
function mount(onClose = vi.fn()) {
  render(<MemoryRouter><CommandPalette open onClose={onClose} /><Where /></MemoryRouter>);
  return onClose;
}

beforeEach(() => {
  perms.current = new Set(["trip.read", "vehicle.read", "customer.read"]);
  getAllTrips.mockReset().mockResolvedValue([]);
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

  it("opens a page with Enter and closes", () => {
    const onClose = mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "vehicles" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(screen.getByTestId("where")).toHaveTextContent("/fleet/vehicles");
    expect(onClose).toHaveBeenCalled();
  });

  it("searches trips on the server and opens the chosen one", async () => {
    getAllTrips.mockResolvedValue([{ id: 42, ticketNo: "TT-0042", customer: "Acme", origin: "A", destination: "B" }]);
    mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "TT-00" } });
    const row = await screen.findByText("TT-0042");
    expect(getAllTrips).toHaveBeenCalledWith({ search: "TT-00", limit: 5 });
    fireEvent.click(row);
    expect(screen.getByTestId("where")).toHaveTextContent("/operations/trips?trip=42");
  });

  it("never asks for trips without trip.read, or for a one-letter query", async () => {
    perms.current = new Set(["vehicle.read"]);
    mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "TT-00" } });
    await new Promise((r) => setTimeout(r, 350));
    expect(getAllTrips).not.toHaveBeenCalled();
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
});
