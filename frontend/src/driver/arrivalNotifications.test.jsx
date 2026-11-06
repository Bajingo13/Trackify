import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ArrivalNotificationToggle from "./ArrivalNotificationToggle"
import {
  arrivalNotificationSettingKey,
  arrivalNotificationsEnabled,
  disableArrivalNotifications,
  enableArrivalNotifications,
  showArrivalNotification,
} from "./arrivalNotifications"

const plugin = { requestPermission: vi.fn(), show: vi.fn() }

describe("optional local arrival notifications", () => {
  beforeEach(() => {
    localStorage.clear()
    plugin.requestPermission.mockReset().mockResolvedValue({ granted: true })
    plugin.show.mockReset().mockResolvedValue({ shown: true })
    globalThis.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: { ArrivalNotifications: plugin },
    }
  })

  afterEach(() => {
    delete globalThis.Capacitor
    delete document.visibilityState
  })

  it("is off until the driver opts in, then remembers the choice", async () => {
    expect(arrivalNotificationsEnabled()).toBe(false)
    await enableArrivalNotifications()
    expect(plugin.requestPermission).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(arrivalNotificationSettingKey)).toBe("on")
    expect(arrivalNotificationsEnabled()).toBe(true)
    disableArrivalNotifications()
    expect(arrivalNotificationsEnabled()).toBe(false)
  })

  it("does not enable the feature when Android refuses permission", async () => {
    plugin.requestPermission.mockResolvedValue({ granted: false })
    await expect(enableArrivalNotifications()).rejects.toThrow(/blocked/i)
    expect(localStorage.getItem(arrivalNotificationSettingKey)).toBeNull()
  })

  it("alerts in the background but avoids duplicating the foreground arrival banner", async () => {
    await enableArrivalNotifications()
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })
    expect(await showArrivalNotification({ tripId: 41, destination: "Tagum City" })).toBe(true)
    expect(plugin.show).toHaveBeenCalledWith(expect.objectContaining({
      tripId: 41,
      title: "You’ve arrived",
      body: expect.stringContaining("Tagum City"),
    }))
    expect(await showArrivalNotification({ tripId: 41, destination: "Tagum City" })).toBe(false)
    expect(plugin.show).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
    expect(await showArrivalNotification({ tripId: 41, destination: "Tagum City" })).toBe(false)
    expect(plugin.show).toHaveBeenCalledTimes(1)
  })

  it("offers a switch and turns it off without changing system permission", async () => {
    render(<ArrivalNotificationToggle />)
    const toggle = screen.getByRole("switch", { name: "Arrival notification" })
    expect(toggle).toHaveAttribute("aria-checked", "false")
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"))
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-checked", "false")
    expect(plugin.requestPermission).toHaveBeenCalledTimes(1)
  })
})
