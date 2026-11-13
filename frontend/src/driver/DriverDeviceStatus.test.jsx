import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  network: "online",
  native: true,
  background: true,
  location: "granted",
  queue: { total: 0, records: 0, pings: 0, trail: 0 },
  openSettings: vi.fn(() => Promise.resolve(true)),
  checkNow: vi.fn(() => Promise.resolve("online")),
}))

vi.mock("../platform", () => ({
  isNativeApp: () => state.native,
  platformName: () => state.native ? "android" : "web",
}))
vi.mock("./capabilities", () => ({ canShareLocation: () => true }))
vi.mock("./netStatus", () => ({
  useNetStatus: () => state.network,
  checkNow: (...args) => state.checkNow(...args),
}))
vi.mock("./tracking", () => ({
  tracksInBackground: () => state.background,
  openLocationSettings: (...args) => state.openSettings(...args),
}))
vi.mock("./offlineQueue", () => ({
  pendingCount: () => Promise.resolve(state.queue),
  onQueueChange: () => () => {},
}))
vi.mock("./arrivalNotifications", () => ({
  arrivalNotificationsAvailable: () => true,
  arrivalNotificationsEnabled: () => true,
}))
vi.mock("./native", () => ({ tap: () => {}, notifySuccess: () => {} }))

const { default: DriverDeviceStatus } = await import("./DriverDeviceStatus")

beforeEach(() => {
  state.network = "online"
  state.native = true
  state.background = true
  state.location = "granted"
  state.queue = { total: 0, records: 0, pings: 0, trail: 0 }
  state.openSettings.mockClear()
  state.checkNow.mockClear()
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn(() => Promise.resolve({ state: state.location })) },
  })
})

describe("Driver app and device status", () => {
  it("keeps the ready state simple when the important checks pass", async () => {
    render(<DriverDeviceStatus ownerId={4} />)

    expect(await screen.findByText("Connected")).toBeInTheDocument()
    expect(screen.getByText("Allowed")).toBeInTheDocument()
    expect(screen.getByText("Supported")).toBeInTheDocument()
    expect(screen.getByText("All sent")).toBeInTheDocument()
    expect(screen.getByText("Arrival notifications")).toBeInTheDocument()
  })

  it("shows a direct fix when location is blocked", async () => {
    state.location = "denied"
    render(<DriverDeviceStatus ownerId={4} />)

    expect(await screen.findByText("Blocked")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await waitFor(() => expect(state.openSettings).toHaveBeenCalledTimes(1))
  })

  it("shows saved work without exposing its contents", async () => {
    state.queue = { total: 3, records: 1, pings: 1, trail: 1 }
    render(<DriverDeviceStatus ownerId={4} />)

    expect(await screen.findByText("3 records waiting")).toBeInTheDocument()
    expect(screen.getByText(/does not read your PIN or trip locations/i)).toBeInTheDocument()
  })

  it("checks every row again when the driver refreshes", async () => {
    render(<DriverDeviceStatus ownerId={4} />)
    await screen.findByText("All sent")
    expect(state.checkNow).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }))

    expect(screen.getAllByText("Checking…")).toHaveLength(5)
    expect(screen.getByRole("button", { name: "Refreshing status…" })).toBeDisabled()
    await waitFor(() => expect(state.checkNow).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole("button", { name: "Refresh status" })).toBeEnabled()
  })
})
