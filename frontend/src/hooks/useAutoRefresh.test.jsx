import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { useAutoRefresh } from "./useAutoRefresh"
import LoadFailure, { StaleData } from "../components/shared/LoadFailure"

/**
 * Failing to load, told apart from having nothing to show.
 *
 * This hook used to swallow every error on the reasoning that a blip should
 * not discard data already on screen. That is right for a refresh and wrong
 * for the first load, where there is nothing to keep: the caller rendered its
 * empty defaults instead, so a failed request on a financial report showed
 * ₱0.00 totals with no error and no retry. Zero is an answer, and presenting
 * one that was never given is worse than an error.
 */

function Probe({ load, interval = 60000 }) {
  const { refreshing, lastUpdated, refresh, error, loaded } = useAutoRefresh(load, interval)
  if (!loaded && error) {
    return <LoadFailure error={error} onRetry={refresh} retrying={refreshing} what="the figures" />
  }
  return (
    <div>
      {error && <StaleData error={error} onRetry={refresh} retrying={refreshing} lastUpdated={lastUpdated} />}
      <div data-testid="total">₱0.00</div>
      <div data-testid="loaded">{String(loaded)}</div>
    </div>
  )
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers() })

describe("the first load", () => {
  test("a failure shows the failure, not an empty page of zeros", async () => {
    const load = vi.fn().mockRejectedValue(new Error("The server could not be reached."))
    render(<Probe load={load} />)

    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(screen.getByText(/could not load the figures/i)).toBeTruthy()
    // The regression in one line: the zeros must not be on screen.
    expect(screen.queryByTestId("total")).toBeNull()
  })

  test("it explains what went wrong in words, and offers a retry", async () => {
    const load = vi.fn().mockRejectedValue(Object.assign(new Error("nope"), { status: 500 }))
    render(<Probe load={load} />)

    expect(await screen.findByText(/server had a problem answering/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy()
  })

  test("retrying after a failure loads and clears the error", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue(undefined)
    render(<Probe load={load} />)

    fireEvent.click(await screen.findByRole("button", { name: /try again/i }))

    await waitFor(() => expect(screen.getByTestId("loaded").textContent).toBe("true"))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  test("a permission failure says so rather than blaming the network", async () => {
    const load = vi.fn().mockRejectedValue(Object.assign(new Error("no"), { status: 403 }))
    render(<Probe load={load} />)
    expect(await screen.findByText(/do not have permission/i)).toBeTruthy()
  })
})

describe("a later refresh", () => {
  test("keeps the figures on screen and says they are not current", async () => {
    /*
     * The half that was right all along: data already loaded should survive a
     * blip. What it must not do is keep presenting itself as up to date.
     */
    const load = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error("connection lost"))
    render(<Probe load={load} interval={1000} />)

    await waitFor(() => expect(screen.getByTestId("loaded").textContent).toBe("true"))

    await vi.advanceTimersByTimeAsync(1100)

    expect(await screen.findByRole("status")).toBeTruthy()
    expect(screen.getByText(/these figures are from/i)).toBeTruthy()
    // and the figures are still there
    expect(screen.getByTestId("total")).toBeTruthy()
  })

  test("a success after a failed refresh clears the warning", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValue(undefined)
    render(<Probe load={load} interval={1000} />)

    await waitFor(() => expect(screen.getByTestId("loaded").textContent).toBe("true"))
    await vi.advanceTimersByTimeAsync(1100)
    await screen.findByRole("status")

    await vi.advanceTimersByTimeAsync(1100)
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull())
  })
})

describe("the polling itself", () => {
  test("it does not refresh while the tab is hidden", async () => {
    const load = vi.fn().mockResolvedValue(undefined)
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true)
    render(<Probe load={load} interval={1000} />)

    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(3100)
    expect(load).toHaveBeenCalledTimes(1)

    hidden.mockRestore()
  })
})
