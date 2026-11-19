import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  network: "online",
  native: true,
  background: true,
  location: "granted",
  queue: { total: 0, records: 0, pings: 0, trail: 0 },
  openSettings: vi.fn(() => Promise.resolve(true)),
  openAppSettings: vi.fn(() => Promise.resolve(true)),
  openBatterySettings: vi.fn(() => Promise.resolve(true)),
  checkNow: vi.fn(() => Promise.resolve("online")),
  readiness: {
    foregroundLocation: "granted",
    backgroundLocation: "granted",
    notifications: "granted",
    batteryOptimization: "unrestricted",
  },
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
vi.mock("./deviceReadiness", () => ({
  readDeviceReadiness: () => Promise.resolve(state.readiness),
  openDeviceAppSettings: (...args) => state.openAppSettings(...args),
  openDeviceBatterySettings: (...args) => state.openBatterySettings(...args),
}))

const { default: DriverDeviceStatus } = await import("./DriverDeviceStatus")

beforeEach(() => {
  state.network = "online"
  state.native = true
  state.background = true
  state.location = "granted"
  state.queue = { total: 0, records: 0, pings: 0, trail: 0 }
  state.openSettings.mockClear()
  state.openAppSettings.mockClear()
  state.openBatterySettings.mockClear()
  state.checkNow.mockClear()
  state.readiness = {
    foregroundLocation: "granted",
    backgroundLocation: "granted",
    notifications: "granted",
    batteryOptimization: "unrestricted",
  }
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn(() => Promise.resolve({ state: state.location })) },
  })
})

describe("Driver app and device status", () => {
  it("keeps the ready state simple when the important checks pass", async () => {
    render(<DriverDeviceStatus ownerId={4} />)

    expect(await screen.findByText("Connected")).toBeInTheDocument()
    expect(screen.getByText("Connected").closest(".dr-device-status-badge")).toBeInTheDocument()
    expect(screen.getByText("Connected").closest(".dr-device-status-badge").querySelector(".dr-device-status-mark")).toBeInTheDocument()
    expect(screen.getByText("Allowed")).toBeInTheDocument()
    expect(screen.getByText("Allowed all the time")).toBeInTheDocument()
    expect(screen.getByText("Unrestricted")).toBeInTheDocument()
    expect(screen.getByText("All sent")).toBeInTheDocument()
    expect(screen.getByText("Arrival notifications")).toBeInTheDocument()
  })

  it("shows a direct fix when location is blocked", async () => {
    state.location = "denied"
    state.readiness = { ...state.readiness, foregroundLocation: "denied", backgroundLocation: "denied" }
    render(<DriverDeviceStatus ownerId={4} />)

    const locationRow = (await screen.findByText("Location access")).closest(".dr-device-row")
    expect(within(locationRow).getByText("Blocked")).toBeInTheDocument()
    fireEvent.click(within(locationRow).getByRole("button", { name: "Open settings" }))
    await waitFor(() => expect(state.openAppSettings).toHaveBeenCalledTimes(1))
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

    expect(screen.getAllByText("Checking…")).toHaveLength(6)
    expect(screen.getByRole("button", { name: "Refreshing status…" })).toBeDisabled()
    await waitFor(() => expect(state.checkNow).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole("button", { name: "Refresh status" })).toBeEnabled()
  })

  it("points a battery-restricted phone to Android battery settings", async () => {
    state.readiness = { ...state.readiness, batteryOptimization: "optimized" }
    render(<DriverDeviceStatus ownerId={4} />)

    expect(await screen.findByText("Restricted")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Open battery settings" }))
    await waitFor(() => expect(state.openBatterySettings).toHaveBeenCalledTimes(1))
  })
})
