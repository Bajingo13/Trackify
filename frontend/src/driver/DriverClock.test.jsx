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

  it("shows only the time without a clock icon", () => {
    const { container } = render(<DriverClock />)
    expect(container.querySelector("svg")).toBeNull()
  })
})
