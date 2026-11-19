import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../platform", () => ({ isNativeApp: () => true }))

const {
  deviceReadinessAvailable,
  openDeviceAppSettings,
  openDeviceBatterySettings,
  readDeviceReadiness,
} = await import("./deviceReadiness")

afterEach(() => { delete globalThis.Capacitor })

describe("Android device readiness bridge", () => {
  it("reads only normalized permission and battery states from the native bridge", async () => {
    globalThis.Capacitor = {
      Plugins: {
        DeviceReadiness: {
          getStatus: vi.fn(() => Promise.resolve({
            foregroundLocation: "granted",
            backgroundLocation: "granted",
            notifications: "granted",
            batteryOptimization: "unrestricted",
            ignoredExtraValue: "private",
          })),
        },
      },
    }

    expect(deviceReadinessAvailable()).toBe(true)
    expect(await readDeviceReadiness()).toEqual({
      foregroundLocation: "granted",
      backgroundLocation: "granted",
      notifications: "granted",
      batteryOptimization: "unrestricted",
    })
  })

  it("fails closed when the native bridge is missing or returns unfamiliar values", async () => {
    expect(await readDeviceReadiness()).toBeNull()
    globalThis.Capacitor = {
      Plugins: { DeviceReadiness: { getStatus: () => Promise.resolve({ batteryOptimization: "mystery" }) } },
    }
    expect(await readDeviceReadiness()).toEqual({
      foregroundLocation: "denied",
      backgroundLocation: "denied",
      notifications: "denied",
      batteryOptimization: "unknown",
    })
  })

  it("opens only the native settings destinations", async () => {
    const openAppSettings = vi.fn(() => Promise.resolve({ opened: true }))
    const openBatterySettings = vi.fn(() => Promise.resolve({ opened: true }))
    globalThis.Capacitor = { Plugins: { DeviceReadiness: { openAppSettings, openBatterySettings } } }

    expect(await openDeviceAppSettings()).toBe(true)
    expect(await openDeviceBatterySettings()).toBe(true)
    expect(openAppSettings).toHaveBeenCalledTimes(1)
    expect(openBatterySettings).toHaveBeenCalledTimes(1)
  })
})
