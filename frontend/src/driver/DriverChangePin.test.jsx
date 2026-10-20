import { describe, expect, it, vi, beforeEach } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

const api = vi.hoisted(() => ({ driverChangePin: vi.fn() }))
vi.mock("./driverApi", () => api)
vi.mock("./native", () => ({ notifySuccess: () => {} }))

const { default: DriverChangePin } = await import("./DriverChangePin")

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const fill = (current, next, again = next) => {
  type("Current PIN", current)
  type("New PIN (4 to 6 digits)", next)
  type("Type the new PIN again", again)
}

// A block body: a function returned from beforeEach is run as its teardown, and mockReset returns the mock.
beforeEach(() => { api.driverChangePin.mockReset() })

describe("changing the PIN from Profile", () => {
  it("asks for the current PIN, and the new one twice", async () => {
    api.driverChangePin.mockResolvedValue({ emailed: true })
    const onDone = vi.fn()
    render(<DriverChangePin email="juan@gmail.com" onDone={onDone} />)
    const button = screen.getByRole("button", { name: "Change PIN" })
    expect(button).toBeDisabled()
    fill("482613", "739204")
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(await screen.findByText("PIN changed")).toBeInTheDocument()
    expect(screen.getByText(/sent a notice to juan@gmail\.com/)).toBeInTheDocument()
    expect(api.driverChangePin).toHaveBeenCalledWith("482613", "739204")
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(onDone).toHaveBeenCalled()
  })

  it("won't send new PINs that don't match, or the same PIN again", () => {
    render(<DriverChangePin onDone={() => {}} />)
    fill("482613", "739204", "739205")
    expect(screen.getByRole("alert")).toHaveTextContent("The new PINs don't match.")
    expect(screen.getByRole("button", { name: "Change PIN" })).toBeDisabled()
    fill("482613", "482613")
    expect(screen.getByRole("alert")).toHaveTextContent("must be different")
  })

  it("shows the server's reason, and clears a wrong current PIN", async () => {
    api.driverChangePin.mockImplementation(async () => { throw Object.assign(new Error("Your current PIN isn't right."), { status: 403 }) })
    render(<DriverChangePin onDone={() => {}} />)
    fill("111111", "739204")
    fireEvent.click(screen.getByRole("button", { name: "Change PIN" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Your current PIN isn't right.")
    expect(screen.getByLabelText("Current PIN")).toHaveValue("")
  })

  it("only digits go in", () => {
    render(<DriverChangePin onDone={() => {}} />)
    type("Current PIN", "48a2-61")
    expect(screen.getByLabelText("Current PIN")).toHaveValue("48261")
  })
})
