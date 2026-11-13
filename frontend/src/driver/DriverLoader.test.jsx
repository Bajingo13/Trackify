import { describe, expect, it, vi, afterEach } from "vitest"
import { act, render, screen } from "@testing-library/react"
import DriverLoader from "./DriverLoader"

afterEach(() => { vi.useRealTimers() })

describe("the Driver App loader", () => {
  it("full screen (signing in or out, restoring the app) shows at once", () => {
    const { container } = render(<DriverLoader label="Signing you in…" />)
    expect(screen.getByRole("status", { name: "Signing you in…" })).toBeInTheDocument()
    expect(container.querySelector(".dr-skeleton-screen")).toBeInTheDocument()
    expect(container.querySelector(".dr-pinmark")).toBeNull()
  })

  it("inside a screen it holds back, so a quick load never flashes it", () => {
    vi.useFakeTimers()
    const { container } = render(<DriverLoader variant="screen" label="Loading your trips…" />)
    // announced, and its space kept, but nothing drawn yet
    expect(screen.getByRole("status", { name: "Loading your trips…" })).toBeInTheDocument()
    expect(container.querySelector(".dr-pinmark")).toBeNull()
    expect(screen.queryByText("Loading your trips…")).toBeNull()

    act(() => { vi.advanceTimersByTime(300) })
    expect(container.querySelector(".dr-skeleton-screen")).not.toBeNull()
    expect(container.querySelector(".dr-pinmark")).toBeNull()
  })

  it("is gone without ever showing when the data beats the wait", () => {
    vi.useFakeTimers()
    const { container, unmount } = render(<DriverLoader variant="inline" label="Loading messages…" />)
    act(() => { vi.advanceTimersByTime(150) })
    expect(container.querySelector(".dr-pinmark")).toBeNull()
    unmount()
    act(() => { vi.advanceTimersByTime(500) }) // no timer left behind to fire on an unmounted loader
  })

  it("uses a compact skeleton instead of a pin for inline waits", () => {
    const { container } = render(<DriverLoader variant="inline" delay={0} label="Loading messages…" />)
    expect(container.querySelector(".dr-skeleton-inline")).toBeInTheDocument()
    expect(container.querySelector(".dr-pinmark")).toBeNull()
  })

  it("draws a Today skeleton that mirrors the content replacing it", () => {
    const { container } = render(
      <DriverLoader variant="screen" skeleton="home" delay={0} label="Loading your trips…" />,
    )
    expect(container.querySelector(".dr-skeleton-home")).toBeInTheDocument()
    expect(container.querySelectorAll(".dr-skeleton-stat")).toHaveLength(3)
    expect(container.querySelector(".dr-skeleton-current")).toBeInTheDocument()
    expect(container.querySelectorAll(".dr-skeleton-progress-step")).toHaveLength(4)
    expect(container.querySelectorAll(".dr-skeleton-run")).toHaveLength(2)
    expect(container.querySelector(".dr-pinmark")).toBeNull()
    expect(screen.getByRole("status", { name: "Loading your trips…" })).toHaveAttribute("aria-busy", "true")
  })

  it("uses a structural skeleton for every full-screen data wait", () => {
    const { container } = render(<DriverLoader variant="screen" delay={0} label="Opening your request…" />)
    expect(container.querySelector(".dr-skeleton-screen-lead")).toBeInTheDocument()
    expect(container.querySelectorAll(".dr-skeleton-screen-row")).toHaveLength(4)
    expect(container.querySelector(".dr-pinmark")).toBeNull()
  })

})
