import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

/*
 * The shell (sidebar, top bar) needs a signed-in session and is not what this
 * is about, so it is reduced to its children.
 */
vi.mock("../components/layout/AppShell", () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock("../services/realtime", () => ({ useRealtime: () => {} }));
vi.mock("../auth/permissions", () => ({
  usePermissions: () => ({ can: () => true, canAny: () => true, canAll: () => true }),
  Can: ({ children }) => children,
}));
// The greeting header reads the session; the page around it is what is under test.
vi.mock("../components/dashboard/DashboardHeader", () => ({ default: () => <header>Dashboard header</header> }));
vi.mock("../services/dashboardService", () => ({
  getDashboardSummary: () => Promise.reject(Object.assign(new Error("Service temporarily unavailable."), { status: 503 })),
}));

const { default: DashboardPage } = await import("./DashboardPage");

/**
 * H2: when the dashboard cannot load, it must say so — not show zeros, and
 * not crash. The first version of this screen crashed instead, because the
 * failure branch used a component it never imported; nothing rendered it.
 */
describe("dashboard that cannot load", () => {
  it("says it could not load, with a way to retry", async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the dashboard");
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });
});
