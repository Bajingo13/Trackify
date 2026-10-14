import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("./driverApi", () => ({
  driverExpenses: () => Promise.resolve([]),
  driverSubmitExpense: vi.fn(),
}))
vi.mock("./native", () => ({ tap: vi.fn() }))

const { default: DriverExpenses } = await import("./DriverExpenses")

describe("trip expenses", () => {
  it("keeps the full-screen claim canvas outside the dark expense card", async () => {
    const { container } = render(
      <div className="dr" data-tab="trips">
        <DriverExpenses tripId={32} ticketNo="TT-2026-000032" canAdd />
      </div>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Add an expense" }))

    const dialog = await screen.findByRole("dialog", { name: "Submit a claim" })
    expect(dialog.closest(".dr-card")).toBeNull()
    expect(container.querySelector(".dr-card").nextElementSibling).toBe(dialog)
    expect(
      screen.getByRole("radio", { name: /TT-2026-000032/ }),
    ).toBeInTheDocument()
  })
})
