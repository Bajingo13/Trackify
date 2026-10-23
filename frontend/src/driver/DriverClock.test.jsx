import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import DriverClock, { formatDriverClock } from "./DriverClock"

afterEach(() => {
  vi.useRealTimers()
})

describe("the clock below the driver's name", () => {
  it("shows seconds in the device's local time", () => {
    const now = new Date(2026, 9, 20, 14, 7, 9)
    expect(formatDriverClock(now)).toMatch(/2:07:09\s*PM/i)
  })

  it("keeps the displayed time current", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 20, 14, 7, 9))
    render(<DriverClock />)

    expect(screen.getByText(/2:07:09\s*PM/i)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByText(/2:07:10\s*PM/i)).toBeInTheDocument()
  })

  it("greets by first name only, beside the greeting", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 23, 10, 29, 12))
    const { container } = render(<DriverClock name="Paul Elisha Panhilason Rosal" />)

    expect(container.querySelector(".dr-hello-line").textContent).toBe("Good morning, Paul")
    expect(screen.queryByText(/Rosal/)).toBeNull()
  })

  it("puts the time and date together under the name", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 23, 10, 29, 12))
    const { container } = render(<DriverClock name="Paul Rosal" />)

    const when = container.querySelector(".dr-when")
    expect(when.textContent).toMatch(/10:29:12\s*AM/i)
    expect(when.textContent).toMatch(/Oct\s+23/)
  })

  it("turns the greeting over at noon without a reload", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 23, 11, 59, 59))
    render(<DriverClock name="Paul" />)
    expect(screen.getByText("Good morning,")).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByText("Good afternoon,")).toBeInTheDocument()
  })

  it("shows only the time without a clock icon", () => {
    const { container } = render(<DriverClock />)
    expect(container.querySelector("svg")).toBeNull()
  })
})
