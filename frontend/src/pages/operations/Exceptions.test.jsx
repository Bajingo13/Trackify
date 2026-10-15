import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../components/layout/AppShell", () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock("../../components/shared/Toast", () => ({ useToast: () => ({ addToast: () => {} }) }));
vi.mock("../../services/realtime", () => ({ useRealtime: () => {} }));
vi.mock("../../auth/permissions", () => ({
  Can: ({ children }) => children,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("../../components/operations/DriverReportPanel", () => ({ default: () => null }));
vi.mock("../../services/operations/tripService", () => ({ getAllTrips: () => Promise.resolve([]) }));
vi.mock("../../services/operations/exceptionService", async (importOriginal) => ({
  waitingFor: (await importOriginal()).waitingFor,
  getExceptions: (...a) => state.get(...a),
  getExceptionStats: (rows) => ({
    total: rows.length,
    open: rows.filter((r) => r.status === "open").length,
    acknowledged: rows.filter((r) => r.status === "acknowledged").length,
    resolved: rows.filter((r) => r.status === "resolved").length,
    critical: 0, warning: 0, info: 0,
  }),
  acknowledgeException: vi.fn(),
  resolveException: vi.fn(),
  createException: vi.fn(),
  exceptionTypes: { trip_delay: "Trip Delay", vehicle_breakdown: "Vehicle Breakdown", driver_concern: "Driver Concern" },
}));

import ExceptionsPage from "./Exceptions";

const row = (id, status, extra = {}) => ({
  id, tripTicketId: id, tripTicket: `TT-${id}`, type: "trip_delay", severity: "warning", title: `Issue ${id}`,
  description: `Description ${id}`, location: "Davao", driver: "Juan", vehicle: "ABC", status,
  detectedAt: "2026-10-14T08:00:00", acknowledgedAt: null, resolvedAt: status === "resolved" ? "2026-10-14T10:00:00" : null,
  resolutionNotes: null, sourceKind: null, sourceId: null, ...extra,
});

const show = () => render(<MemoryRouter><ExceptionsPage /></MemoryRouter>);

describe("the Exceptions board: active and finished", () => {
  beforeEach(() => {
    state.get.mockReset().mockResolvedValue({
      items: [
        row(1, "open"),
        row(2, "acknowledged"),
        row(3, "resolved", { resolvedAt: "2026-10-14T09:00:00" }),
        row(4, "resolved", { resolvedAt: "2026-10-14T11:00:00" }),
      ],
      muted: [],
    });
  });

  it("opens on the work still to do, and keeps resolved exceptions out of it", async () => {
    show();
    expect(await screen.findByText("Issue 1")).toBeInTheDocument();
    expect(screen.getByText("Issue 2")).toBeInTheDocument();
    expect(screen.queryByText("Issue 3")).toBeNull();
    expect(screen.queryByText("Issue 4")).toBeNull();
    expect(screen.getByRole("button", { name: "Active (2)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Finished (2)" })).toBeInTheDocument();
  });

  it("shows resolved ones under Finished, latest first, with when they were resolved", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Finished (2)" }));
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(/TT-4/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/TT-3/)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Resolved" })).toBeInTheDocument();
    expect(screen.queryByText("Issue 1")).toBeNull();
  });

  it("shows everything under All", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "All (4)" }));
    expect(screen.getAllByRole("row")).toHaveLength(5);
  });

  it("goes to Finished when the Resolved card is chosen, and back to Active for Open", async () => {
    show();
    await screen.findByText("Issue 1");
    fireEvent.click(screen.getByText("Resolved").closest("button") || screen.getByText("Resolved"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Finished (2)" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByText("Issue 4")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open").closest("button") || screen.getByText("Open"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Active (2)" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByText("Issue 1")).toBeInTheDocument();
    expect(screen.queryByText("Issue 2")).toBeNull();
  });

  it("says everything is handled when only finished ones remain, and points to Finished", async () => {
    state.get.mockResolvedValue({ items: [row(3, "resolved")], muted: [] });
    show();
    expect(await screen.findByText("No active exceptions")).toBeInTheDocument();
    expect(screen.getByText(/Finished exceptions are under Finished/)).toBeInTheDocument();
  });

  it("tells the office how long a driver has been waiting, on the row, and only while nobody has answered", async () => {
    const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
    state.get.mockResolvedValue({
      items: [
        row(1, "open", { sourceKind: "pause", awaitingSince: ago(130) }),
        row(2, "acknowledged", { sourceKind: "support", awaitingSince: null }),
        row(3, "resolved", { sourceKind: "support", awaitingSince: ago(500) }),
      ],
      muted: [],
    });
    show();
    expect(await screen.findByText("Waiting 2 h 10 min")).toBeInTheDocument();
    // answered, or finished: no tag
    expect(screen.getAllByText(/^Waiting /)).toHaveLength(1);
  });

  it("keeps a pause decision in one place and hides repeated resolution controls", async () => {
    state.get.mockResolvedValue({
      items: [row(1, "acknowledged", { sourceKind: "pause", title: "Delivery paused" })],
      muted: [],
    });
    show();
    fireEvent.click(await screen.findByRole("button", { name: /View/ }));

    const dialog = screen.getByRole("dialog", { name: "Exception Details" });
    expect(within(dialog).getByText("Delivery paused")).toBeInTheDocument();
    expect(within(dialog).getByText("Activity")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/How was this resolved/)).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Resolve/ })).toBeNull();
  });


  describe("a page at a time", () => {
    const many = (n) => Array.from({ length: n }, (_, i) => row(i + 1, "open", { title: `Issue ${i + 1}`, description: `Description ${i + 1}` }));
    const bodyRows = () => screen.getAllByRole("row").slice(1);

    beforeEach(() => {
      localStorage.clear();
      state.get.mockResolvedValue({ items: many(25), muted: [] });
    });

    it("shows ten rows, says how many there are, and keeps the rest on the other pages", async () => {
      show();
      await screen.findByText("Issue 1");
      expect(bodyRows()).toHaveLength(10);
      expect(screen.getByText("Showing 1–10 of 25 exceptions")).toBeInTheDocument();
      expect(screen.queryByText("Issue 11")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      expect(screen.getByText("Showing 11–20 of 25 exceptions")).toBeInTheDocument();
      expect(screen.getByText("Issue 11")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
      expect(bodyRows()).toHaveLength(5);
      expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    });

    it("lets the office choose how many rows to see per page", async () => {
      show();
      await screen.findByText("Issue 1");
      fireEvent.click(screen.getByRole("combobox", { name: "Rows per page" }));
      fireEvent.click(await screen.findByRole("option", { name: "25" }));
      await waitFor(() => expect(bodyRows()).toHaveLength(25));
      expect(screen.getByText("Showing 1–25 of 25 exceptions")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
    });

    it("goes back to the first page when the list is searched, and counts only what matches", async () => {
      show();
      await screen.findByText("Issue 1");
      fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
      fireEvent.change(screen.getByPlaceholderText("Search exceptions..."), { target: { value: "Description 2" } });
      // "Description 2", 20 to 25: seven rows in all
      await waitFor(() => expect(screen.getByText("Showing 1–7 of 7 exceptions")).toBeInTheDocument());
    });

    it("keeps its pager when moving between Active and Finished", async () => {
      state.get.mockResolvedValue({ items: [...many(12), ...Array.from({ length: 11 }, (_, i) => row(100 + i, "resolved"))], muted: [] });
      show();
      await screen.findByText("Issue 1");
      expect(screen.getByText("Showing 1–10 of 12 exceptions")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Finished (11)" }));
      expect(screen.getByText("Showing 1–10 of 11 exceptions")).toBeInTheDocument();
    });
  });

});
