import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ get: vi.fn(), enable: vi.fn(), disable: vi.fn() }))
vi.mock("./push", () => ({
  pushState: (...a) => state.get(...a),
  enablePush: (...a) => state.enable(...a),
  disablePush: (...a) => state.disable(...a),
}))
vi.mock("./native", () => ({ tap: vi.fn() }))

import PushToggle from "./PushToggle"

describe("notifications on this phone", () => {
  beforeEach(() => {
    state.get.mockReset()
    state.enable.mockReset().mockResolvedValue("on")
    state.disable.mockReset().mockResolvedValue("off")
  })

  it("offers nothing where the browser or app cannot do it, or the server has no keys", async () => {
    for (const s of ["unsupported", "unavailable"]) {
      state.get.mockResolvedValue(s)
      const { container, unmount } = render(<PushToggle />)
      await waitFor(() => expect(state.get).toHaveBeenCalled())
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
  })

  it("offers to turn them on, and says what they are for", async () => {
    state.get.mockResolvedValue("off")
    render(<PushToggle />)
    expect(await screen.findByText("Get notified on this phone")).toBeInTheDocument()
    expect(screen.getByText(/when the office replies or decides a pause/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Turn on" }))
    await waitFor(() => expect(state.enable).toHaveBeenCalled())
    expect(await screen.findByText("Notifications are on")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Turn off" })).toBeInTheDocument()
  })

  it("turns them off again", async () => {
    state.get.mockResolvedValue("on")
    render(<PushToggle />)
    fireEvent.click(await screen.findByRole("button", { name: "Turn off" }))
    await waitFor(() => expect(state.disable).toHaveBeenCalled())
    expect(await screen.findByText("Get notified on this phone")).toBeInTheDocument()
  })

  it("shows nothing when the driver has blocked them in the browser", async () => {
    state.get.mockResolvedValue("denied")
    const { container } = render(<PushToggle />)
    await waitFor(() => expect(state.get).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it("stays on the same state and shows why when turning on fails", async () => {
    state.get.mockResolvedValue("off")
    state.enable.mockRejectedValue(new Error("Notifications are not ready on this phone yet."))
    render(<PushToggle />)
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("not ready")
    expect(screen.getByRole("button", { name: "Turn on" })).toBeInTheDocument()
  })

  it("is refused permission: the choice is respected and the card goes away", async () => {
    state.get.mockResolvedValue("off")
    state.enable.mockResolvedValue("denied")
    const { container } = render(<PushToggle />)
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
