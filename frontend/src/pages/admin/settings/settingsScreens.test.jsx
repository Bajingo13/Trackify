import { describe, test, expect, beforeEach, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

/**
 * The two settings screens.
 *
 * What is worth testing here is not that they render. It is that a control
 * never shows a setting the server does not hold — the failure where somebody
 * flips a switch, sees it move, and finds out months later that nothing was
 * saved. So: the preview follows the field, an invalid value cannot be sent,
 * and a refused toggle springs back.
 */

const getCompanySettings = vi.fn()
const updateCompanySettings = vi.fn()
const getAlertPreferences = vi.fn()
const setAlertPreferences = vi.fn()
const addToast = vi.fn()
const hasPermission = vi.fn(() => true)

vi.mock("../../../services/admin/settingsService", () => ({
  getCompanySettings: (...a) => getCompanySettings(...a),
  updateCompanySettings: (...a) => updateCompanySettings(...a),
  getAlertPreferences: (...a) => getAlertPreferences(...a),
  setAlertPreferences: (...a) => setAlertPreferences(...a),
}))

vi.mock("../../../components/shared/Toast", () => ({
  useToast: () => ({ addToast }),
}))

vi.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ hasPermission: (...a) => hasPermission(...a) }),
}))

const { default: GeneralSettingsPage } = await import("./GeneralSettingsPage")
const { default: NotificationsPage } = await import("./NotificationsPage")

const YEAR = new Date().getFullYear()

const SETTINGS = {
  tripPrefix: "TT",
  locationRetentionMonths: 12,
  defaults: { tripPrefix: "TT", locationRetentionMonths: 12 },
  retentionRange: { min: 1, max: 120 },
  sampleTicketNo: `TT-${YEAR}-000123`,
}

beforeEach(() => {
  hasPermission.mockReturnValue(true)
  getCompanySettings.mockResolvedValue({ ...SETTINGS })
  updateCompanySettings.mockImplementation(async (payload) => ({ ...SETTINGS, ...payload }))
  getAlertPreferences.mockResolvedValue({ types: [], muted: [] })
  setAlertPreferences.mockImplementation(async (muted) => ({ muted }))
})

describe("General settings", () => {
  test("the preview shows the number the next ticket will actually carry", async () => {
    // The format is shown rather than described, so it has to follow the field
    // it claims to preview.
    render(<GeneralSettingsPage />)
    const prefix = await screen.findByLabelText(/prefix/i)

    fireEvent.change(prefix, { target: { value: "dvo" } })

    expect(await screen.findByText(`DVO-${YEAR}-000123`)).toBeTruthy()
  })

  test("a prefix the server would refuse cannot be sent at all", async () => {
    render(<GeneralSettingsPage />)
    const prefix = await screen.findByLabelText(/prefix/i)

    fireEvent.change(prefix, { target: { value: "TT 2026/A" } })
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }))

    await waitFor(() => expect(screen.getByText(/letters, numbers and dashes/i)).toBeTruthy())
    expect(updateCompanySettings).not.toHaveBeenCalled()
  })

  test("saving sends the whole pair, so neither setting is dropped", async () => {
    /*
     * The server treats an absent field as "leave it alone", but the screen
     * has both in hand — sending both is what makes what you see on the page
     * the thing that is stored.
     */
    render(<GeneralSettingsPage />)
    const prefix = await screen.findByLabelText(/prefix/i)

    fireEvent.change(prefix, { target: { value: "ABC" } })
    const save = await screen.findByRole("button", { name: /save changes/i })
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)

    await waitFor(() =>
      expect(updateCompanySettings).toHaveBeenCalledWith({
        tripPrefix: "ABC",
        locationRetentionMonths: 12,
      })
    )
  })

  test("nothing changed means nothing to save", async () => {
    render(<GeneralSettingsPage />)
    const save = await screen.findByRole("button", { name: /save changes/i })
    await waitFor(() => expect(screen.getByLabelText(/prefix/i).value).toBe("TT"))
    expect(save.disabled).toBe(true)
  })

  test("without the right to manage the company, the fields are readable and not editable", async () => {
    // Read-only, not hidden: knowing how long the trail is kept matters to
    // anyone answering a driver's question about it.
    hasPermission.mockReturnValue(false)
    render(<GeneralSettingsPage />)

    const prefix = await screen.findByLabelText(/prefix/i)
    expect(prefix.disabled).toBe(true)
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull()
  })
})

describe("Notifications", () => {
  test("everything is on for somebody who has never opened the screen", async () => {
    // Mutes, not subscriptions: nobody should be missing a failed delivery
    // because they never visited a settings page.
    render(<NotificationsPage />)

    const switches = await screen.findAllByRole("switch")
    expect(switches.length).toBe(12)
    expect(switches.every((s) => s.getAttribute("aria-checked") === "true")).toBe(true)
  })

  test("muting one alert sends the whole set, not just the change", async () => {
    getAlertPreferences.mockResolvedValue({ types: [], muted: ["gps_offline"] })
    render(<NotificationsPage />)

    const failed = await screen.findByRole("switch", { name: /failed delivery/i })
    fireEvent.click(failed)

    await waitFor(() =>
      expect(setAlertPreferences).toHaveBeenCalledWith(["gps_offline", "failed_delivery"])
    )
  })

  test("a toggle the server refuses springs back instead of lying", async () => {
    /*
     * The whole point of the screen. A switch left showing "muted" after a
     * failed save is a person believing they turned something off.
     */
    setAlertPreferences.mockRejectedValue(new Error("network is down"))
    render(<NotificationsPage />)

    const trip = await screen.findByRole("switch", { name: /trip delay/i })
    fireEvent.click(trip)

    await waitFor(() => expect(trip.getAttribute("aria-checked")).toBe("true"))
    expect(addToast).toHaveBeenCalledWith(expect.stringMatching(/nothing changed/i), "error")
  })

  test("an already-muted alert shows as muted when the screen loads", async () => {
    getAlertPreferences.mockResolvedValue({ types: [], muted: ["route_deviation"] })
    render(<NotificationsPage />)

    const deviation = await screen.findByRole("switch", { name: /route deviation/i })
    await waitFor(() => expect(deviation.getAttribute("aria-checked")).toBe("false"))
    expect(screen.getAllByText(/muted/i).length).toBeGreaterThan(0)
  })
})
