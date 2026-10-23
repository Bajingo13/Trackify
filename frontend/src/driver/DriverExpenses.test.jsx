import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { setNet } from "./netStatus"

vi.mock("./netStatus", () => import("./netStatus.mock"))

vi.mock("./driverApi", () => ({
  driverExpenses: () => Promise.resolve([]),
  driverSubmitExpense: vi.fn(),
  currentDriverId: () => 7,
}))
vi.mock("./native", () => ({ tap: vi.fn() }))

const { default: DriverExpenses } = await import("./DriverExpenses")

describe("trip expenses", () => {
  it("in compact mode drops the big button for a small Add link, and the page decides when the form opens", async () => {
    const onFilingChange = vi.fn()
    const { rerender } = render(
      <DriverExpenses tripId={32} ticketNo="TT-2026-000032" canAdd compact filing={false} onFilingChange={onFilingChange} />,
    )
    await screen.findByText("None yet")

    // one way in, and it is the small link — not a second full-width button
    const link = screen.getByRole("button", { name: "Add an expense" })
    expect(link).toHaveClass("dr-linkbtn")
    expect(link).toHaveTextContent("+ Add")
    fireEvent.click(link)
    expect(onFilingChange).toHaveBeenCalledWith(true)
    expect(screen.queryByRole("dialog")).toBeNull()

    // opened from elsewhere (the + Expense button), it shows the same claim form
    rerender(
      <DriverExpenses tripId={32} ticketNo="TT-2026-000032" canAdd compact filing onFilingChange={onFilingChange} />,
    )
    expect(await screen.findByRole("dialog", { name: "Submit a claim" })).toBeInTheDocument()
  })

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
