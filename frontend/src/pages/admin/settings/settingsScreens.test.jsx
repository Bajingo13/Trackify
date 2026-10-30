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

describe("General settings: the emergency line", () => {
  const lineInput = () => screen.findByLabelText(/emergency number/i)
  const saveButton = async () => {
    const save = await screen.findByRole("button", { name: /save changes/i })
    await waitFor(() => expect(save.disabled).toBe(false))
    return save
  }

  test("with none saved, says plainly that a demo number is in use and is not a real hotline", async () => {
    getCompanySettings.mockResolvedValue({ ...SETTINGS, emergencyLine: null, emergencyLineDemo: "+63 900 000 0000" })
    render(<GeneralSettingsPage />)

    expect((await lineInput()).value).toBe("")
    expect(await screen.findByText(/demo number in use: \+63 900 000 0000/i)).toBeTruthy()
    expect(screen.getByText(/not a real hotline/i)).toBeTruthy()
  })

  test("with none saved and no demo (production), says drivers are offered 911", async () => {
    getCompanySettings.mockResolvedValue({ ...SETTINGS, emergencyLine: null, emergencyLineDemo: null })
    render(<GeneralSettingsPage />)

    expect(await screen.findByText(/drivers are offered 911/i)).toBeTruthy()
  })

  test("a number is entered and saved, and the demo notice goes away", async () => {
    getCompanySettings.mockResolvedValue({ ...SETTINGS, emergencyLine: null, emergencyLineDemo: "+63 900 000 0000" })
    updateCompanySettings.mockImplementation(async (payload) => ({
      ...SETTINGS, ...payload, emergencyLine: payload.emergencyLine, emergencyLineDemo: null,
    }))
    render(<GeneralSettingsPage />)

    fireEvent.change(await lineInput(), { target: { value: " +63 82  224 1234 " } })
    fireEvent.click(await saveButton())

    await waitFor(() =>
      expect(updateCompanySettings).toHaveBeenCalledWith({
        tripPrefix: "TT",
        locationRetentionMonths: 12,
        emergencyLine: "+63 82 224 1234",
      })
    )
    await waitFor(() => expect(screen.queryByText(/demo number in use/i)).toBeNull())
    expect((await lineInput()).value).toBe("+63 82 224 1234")
  })

  test("a saved number can be changed, and cleared", async () => {
    getCompanySettings.mockResolvedValue({ ...SETTINGS, emergencyLine: "911", emergencyLineDemo: null })
    render(<GeneralSettingsPage />)
    await waitFor(async () => expect((await lineInput()).value).toBe("911"))

    fireEvent.change(await lineInput(), { target: { value: "(082) 224-1234" } })
    fireEvent.click(await saveButton())
    await waitFor(() =>
      expect(updateCompanySettings).toHaveBeenLastCalledWith(expect.objectContaining({ emergencyLine: "(082) 224-1234" }))
    )

    fireEvent.change(await lineInput(), { target: { value: "" } })
    fireEvent.click(await saveButton())
    await waitFor(() =>
      expect(updateCompanySettings).toHaveBeenLastCalledWith(expect.objectContaining({ emergencyLine: "" }))
    )
  })

  test("something that is not a phone number cannot be sent", async () => {
    getCompanySettings.mockResolvedValue({ ...SETTINGS, emergencyLine: null, emergencyLineDemo: null })
    render(<GeneralSettingsPage />)

    for (const bad of ["call Juan", "12", "0917+1234567"]) {
      fireEvent.change(await lineInput(), { target: { value: bad } })
      // eslint-disable-next-line no-await-in-loop
      expect(await screen.findByText(/3 to 15 digits/i)).toBeTruthy()
      expect(screen.getByRole("button", { name: /save changes/i }).disabled).toBe(true)
    }
    expect(updateCompanySettings).not.toHaveBeenCalled()
  })

  test("saving the other settings leaves the line out of the request", async () => {
    // A server without migration 058 can still save the prefix.
    getCompanySettings.mockResolvedValue({ ...SETTINGS, emergencyLine: "911", emergencyLineDemo: null })
    render(<GeneralSettingsPage />)
    fireEvent.change(await screen.findByLabelText(/prefix/i), { target: { value: "ABC" } })
    fireEvent.click(await saveButton())

    await waitFor(() => expect(updateCompanySettings).toHaveBeenCalledTimes(1))
    expect(updateCompanySettings.mock.calls[0][0]).not.toHaveProperty("emergencyLine")
  })

  test("without the right to manage the company, the number is shown but cannot be changed", async () => {
    hasPermission.mockReturnValue(false)
    getCompanySettings.mockResolvedValue({ ...SETTINGS, emergencyLine: "911", emergencyLineDemo: null })
    render(<GeneralSettingsPage />)

    const input = await lineInput()
    await waitFor(() => expect(input.value).toBe("911"))
    expect(input.disabled).toBe(true)
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull()
  })
})

describe("General settings: the pre-trip inspection rule", () => {
  const toggle = () => screen.findByRole("switch", { name: /Require a pre-trip inspection before every trip/i })
  const saveButton = async () => {
    const save = await screen.findByRole("button", { name: /save changes/i })
    await waitFor(() => expect(save.disabled).toBe(false))
    return save
  }

  test("is off until switched on, and switching it on warns about older app versions", async () => {
    getCompanySettings.mockResolvedValue({ ...SETTINGS, requirePreTripInspection: false })
    render(<GeneralSettingsPage />)
    const box = await toggle()
    expect(box.checked).toBe(false)
    expect(screen.queryByText(/updated Driver App/i)).toBeNull()

    fireEvent.click(box)
    expect(await screen.findByText(/Turn this on once every driver has the updated Driver App/i)).toBeTruthy()
  })

  test("switching it on is sent, and only when it changed", async () => {
    getCompanySettings.mockResolvedValue({ ...SETTINGS, requirePreTripInspection: false })
    render(<GeneralSettingsPage />)
    fireEvent.click(await toggle())
    fireEvent.click(await saveButton())
    await waitFor(() =>
      expect(updateCompanySettings).toHaveBeenCalledWith({ tripPrefix: "TT", locationRetentionMonths: 12, requirePreTripInspection: true })
    )
  })

  test("saving something else leaves the rule out of the request", async () => {
    getCompanySettings.mockResolvedValue({ ...SETTINGS, requirePreTripInspection: true })
    render(<GeneralSettingsPage />)
    expect((await toggle()).checked).toBe(true)
    fireEvent.change(screen.getByLabelText(/prefix/i), { target: { value: "ABC" } })
    fireEvent.click(await saveButton())
    await waitFor(() => expect(updateCompanySettings).toHaveBeenCalledTimes(1))
    expect(updateCompanySettings.mock.calls[0][0]).not.toHaveProperty("requirePreTripInspection")
  })

  test("without the right to manage the company, it can be seen but not changed", async () => {
    hasPermission.mockReturnValue(false)
    getCompanySettings.mockResolvedValue({ ...SETTINGS, requirePreTripInspection: true })
    render(<GeneralSettingsPage />)
    const box = await toggle()
    await waitFor(() => expect(box.checked).toBe(true))
    expect(box.disabled).toBe(true)
  })
})

describe("General settings: the odometer rule", () => {
  const toggle = () => screen.findByRole("switch", { name: /Require odometer readings at Start and at delivery/i })

  test("is off until switched on, warns about older app versions, and is sent only when changed", async () => {
    getCompanySettings.mockResolvedValue({ ...SETTINGS, requireOdometer: false })
    render(<GeneralSettingsPage />)
    const box = await toggle()
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(await screen.findByText(/cannot enter a reading/i)).toBeTruthy()
    const save = await screen.findByRole("button", { name: /save changes/i })
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)
    await waitFor(() =>
      expect(updateCompanySettings).toHaveBeenCalledWith({ tripPrefix: "TT", locationRetentionMonths: 12, requireOdometer: true })
    )
  })

  test("without the right to manage the company, it can be seen but not changed", async () => {
    hasPermission.mockReturnValue(false)
    getCompanySettings.mockResolvedValue({ ...SETTINGS, requireOdometer: true })
    render(<GeneralSettingsPage />)
    const box = await toggle()
    await waitFor(() => expect(box.checked).toBe(true))
    expect(box.disabled).toBe(true)
  })
})

describe("General settings: the signature rule", () => {
  test("is off until switched on, warns about older app versions, and is sent only when changed", async () => {
    getCompanySettings.mockResolvedValue({ ...SETTINGS, requireSignature: false })
    render(<GeneralSettingsPage />)
    const box = await screen.findByRole("switch", { name: /Require the receiver.s signature/i })
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(await screen.findByText(/has no signature pad/i)).toBeTruthy()
    const save = await screen.findByRole("button", { name: /save changes/i })
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)
    await waitFor(() =>
      expect(updateCompanySettings).toHaveBeenCalledWith({ tripPrefix: "TT", locationRetentionMonths: 12, requireSignature: true })
    )
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
