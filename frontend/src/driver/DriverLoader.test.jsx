import { describe, expect, it, vi, afterEach } from "vitest"
import { act, render, screen } from "@testing-library/react"
import DriverLoader, { PinMark } from "./DriverLoader"

afterEach(() => { vi.useRealTimers() })

describe("the Driver App loader", () => {
  it("full screen (signing in or out, restoring the app) shows at once", () => {
    render(<DriverLoader label="Signing you in…" />)
    expect(screen.getByRole("status", { name: "Signing you in…" })).toBeInTheDocument()
    expect(screen.getByText("Signing you in…")).toBeInTheDocument()
  })

  it("inside a screen it holds back, so a quick load never flashes it", () => {
    vi.useFakeTimers()
    const { container } = render(<DriverLoader variant="screen" label="Loading your trips…" />)
    // announced, and its space kept, but nothing drawn yet
    expect(screen.getByRole("status", { name: "Loading your trips…" })).toBeInTheDocument()
    expect(container.querySelector(".dr-pinmark")).toBeNull()
    expect(screen.queryByText("Loading your trips…")).toBeNull()

    act(() => { vi.advanceTimersByTime(300) })
    expect(container.querySelector(".dr-pinmark")).not.toBeNull()
    expect(screen.getByText("Loading your trips…")).toBeInTheDocument()
  })

  it("is gone without ever showing when the data beats the wait", () => {
    vi.useFakeTimers()
    const { container, unmount } = render(<DriverLoader variant="inline" label="Loading messages…" />)
    act(() => { vi.advanceTimersByTime(150) })
    expect(container.querySelector(".dr-pinmark")).toBeNull()
    unmount()
    act(() => { vi.advanceTimersByTime(500) }) // no timer left behind to fire on an unmounted loader
  })

  it("draws the wordmark's pin over a ring, in the logo's blues", () => {
    const { container } = render(<PinMark />)
    const pin = container.querySelector(".dr-pinmark-pin path")
    // the same teardrop-with-a-hole as the I in trackify-logo.svg
    expect(pin.getAttribute("d")).toBe("M9.5 40L0.47 12.46A9.5 9.5 0 1 1 18.53 12.46ZM13.5 9.5A4 4 0 1 0 5.5 9.5A4 4 0 1 0 13.5 9.5Z")
    expect(pin.getAttribute("fill-rule")).toBe("evenodd")
    const stops = [...container.querySelectorAll(".dr-pinmark-pin stop")].map((s) => s.getAttribute("stop-color"))
    expect(stops).toEqual(["#38bdf8", "#78a2ff"])
    expect(container.querySelector(".dr-pinmark-ring circle")).toBeInTheDocument()
    expect(container.querySelector(".dr-pinmark").getAttribute("aria-hidden")).toBe("true")
  })

  it("gives two marks on one screen their own gradients", () => {
    const { container } = render(<><PinMark /><PinMark /></>)
    const ids = [...container.querySelectorAll("linearGradient")].map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
