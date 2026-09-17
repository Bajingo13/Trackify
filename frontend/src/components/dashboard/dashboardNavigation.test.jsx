import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigate, getAllTrips, voucherStats, getTransferStats } = vi.hoisted(() => ({
  navigate: vi.fn(),
  getAllTrips: vi.fn(),
  voucherStats: vi.fn(),
  getTransferStats: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("../../services/operations/tripService", () => ({ getAllTrips }));
vi.mock("../../services/finance/financeService", () => ({
  voucherApi: { stats: voucherStats },
}));
vi.mock("../../services/warehouse/branchTransferService", () => ({ getTransferStats }));
vi.mock("../../auth/permissions", () => ({
  Can: ({ children }) => children,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { firstName: "Pat" } }),
}));
vi.mock("../../hooks/useActiveAccess", () => ({
  default: () => ({
    accessList: [{ company_id: 1, company_name: "AstreaBlue", branch_id: 2, branch_name: "Main" }],
    activeCompanyId: 1,
    activeBranchId: 2,
    current: { company_name: "AstreaBlue", branch_name: "Main" },
  }),
}));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }) => <>{children}</>,
  BarChart: ({ children }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

import ActiveTrips from "./ActiveTrips";
import ApprovalQueue from "./ApprovalQueue";
import DashboardHeader from "./DashboardHeader";
import FleetAvailability from "./FleetAvailability";
import TopRoutes from "./TopRoutes";
import TripActivityChart from "./TripActivityChart";

describe("dashboard navigation", () => {
  beforeEach(() => {
    navigate.mockReset();
    getAllTrips.mockReset().mockResolvedValue([]);
    voucherStats.mockReset().mockResolvedValue({ awaitingApproval: 0 });
    getTransferStats.mockReset().mockResolvedValue({ pending: 0 });
  });

  it("opens the selected active trip instead of dropping its identity", () => {
    render(<ActiveTrips trips={[{ id: 42, ticketNo: "TRIP-42", route: "A → B", status: "Assigned" }]} />);

    fireEvent.click(screen.getByLabelText("Open trip TRIP-42"));

    expect(navigate).toHaveBeenCalledWith("/operations/trips?trip=42");
  });

  it("requests the real trip creation view from the dashboard", () => {
    render(<DashboardHeader />);

    fireEvent.click(screen.getByRole("button", { name: "Create new trip" }));

    expect(navigate).toHaveBeenCalledWith("/operations/trips?create=1");
    expect(screen.getByText("Live overview")).toBeInTheDocument();
  });

  it("routes fleet availability to its detailed workspace", () => {
    render(<FleetAvailability data={{ total: 1, available: 1, onTrip: 0, maintenance: 0, unavailable: 0 }} />);

    fireEvent.click(screen.getByRole("button", { name: "View all" }));

    expect(navigate).toHaveBeenCalledWith("/fleet/availability");
  });

  it("routes the dashboard's analytical links to the operations report", () => {
    const { unmount } = render(<TopRoutes data={[{ route: "A → B", trips: 3, onTime: 100 }]} />);
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    expect(navigate).toHaveBeenLastCalledWith("/reports/operations");
    unmount();

    render(<TripActivityChart data={[{ date: "Mon", completed: 1, departed: 2, delayed: 0 }]} />);
    fireEvent.click(screen.getByRole("button", { name: /View full report/ }));
    expect(navigate).toHaveBeenLastCalledWith("/reports/operations");
  });

  it("shows real voucher and transfer queues and opens their working modules", async () => {
    // Placeholder rows hid work that managers needed to act on from the dashboard.
    voucherStats.mockResolvedValue({ awaitingApproval: 3 });
    getTransferStats.mockResolvedValue({ pending: 2 });
    render(<ApprovalQueue />);

    const vouchers = await screen.findByText("3 Expense Vouchers");
    const transfers = await screen.findByText("2 Branch Transfers");
    fireEvent.click(vouchers.closest("button"));
    fireEvent.click(transfers.closest("button"));

    expect(navigate).toHaveBeenCalledWith("/finance/expense-vouchers");
    expect(navigate).toHaveBeenCalledWith("/warehouse/transfers");

    fireEvent.click(screen.getByRole("button", { name: "View queue" }));
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith("/finance/expense-vouchers"));
  });
});
