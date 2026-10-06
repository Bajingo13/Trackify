import { describe, test, expect, beforeEach, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

/**
 * The license is shown plainly: the number first, then the status and what is
 * left. The banner speaks only when something needs doing.
 */

const getMyLicense = vi.fn()
vi.mock("../../services/admin/licenseService", () => ({ getMyLicense: (...a) => getMyLicense(...a) }))

const { default: LicenseCard } = await import("./LicenseCard")
const { default: LicenseBanner, __resetLicenseBannerCache } = await import("./LicenseBanner")
const { describeExpiry, termUsed } = await import("./licenseDisplay")

const NUMBER = "TRK01-ACME-2026-K7M4Q9XT2P"
const license = (over = {}) => ({
  licenseNumber: NUMBER, systemCode: "TRK01", state: "active", valid: true, perpetual: false,
  issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z", daysRemaining: 200, message: null, ...over,
})

beforeEach(() => {
  getMyLicense.mockReset()
  __resetLicenseBannerCache()
  localStorage.setItem("ttms_company_id", "7")
})

describe("LicenseCard", () => {
  test("leads with the number and says what is left", () => {
    render(<LicenseCard license={license()} companyName="ACME Freight" />)
    expect(screen.getByTestId("license-number").textContent).toBe(NUMBER)
    expect(screen.getByText("Active")).toBeTruthy()
    expect(screen.getByText(/200 days left/)).toBeTruthy()
    expect(screen.getByRole("progressbar")).toBeTruthy()
  })

  test("a revoked license says why", () => {
    render(<LicenseCard license={license({ state: "revoked", valid: false, message: "This license has been revoked.", revokedReason: "Contract ended" })} />)
    expect(screen.getByText("Revoked")).toBeTruthy()
    expect(screen.getByRole("status").textContent).toMatch(/Reason: Contract ended/)
  })

  test("a perpetual license has no end and no progress bar", () => {
    render(<LicenseCard license={license({ perpetual: true, expiresAt: null, daysRemaining: null })} />)
    expect(screen.getByText("No end date")).toBeTruthy()
    expect(screen.queryByRole("progressbar")).toBeNull()
  })

  test("a client with no license sees the message, not an empty card", () => {
    render(<LicenseCard license={{ state: "missing", licenseNumber: null, message: "This client has no license. Contact your administrator." }} />)
    expect(screen.getByText("No license")).toBeTruthy()
    expect(screen.queryByTestId("license-number")).toBeNull()
    expect(screen.getByRole("status").textContent).toMatch(/no license/i)
  })
})

describe("licenseDisplay", () => {
  test("describeExpiry and termUsed", () => {
    expect(describeExpiry(license({ daysRemaining: 1 }))).toMatch(/^1 day left/)
    expect(describeExpiry(license({ state: "expired" }))).toMatch(/^Expired on/)
    expect(describeExpiry(license({ perpetual: true }))).toBe("Never expires")
    expect(termUsed(license(), new Date("2026-07-02T00:00:00Z").getTime())).toBe(50)
    expect(termUsed(license({ expiresAt: null }))).toBeNull()
  })
})

describe("LicenseBanner", () => {
  const show = () => render(<MemoryRouter><LicenseBanner /></MemoryRouter>)

  test("says nothing while the license is healthy", async () => {
    getMyLicense.mockResolvedValue(license())
    show()
    await waitFor(() => expect(getMyLicense).toHaveBeenCalled())
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  test("warns before expiry, with a link to the license", async () => {
    getMyLicense.mockResolvedValue(license({ state: "expiring", daysRemaining: 9 }))
    show()
    expect((await screen.findByRole("status")).textContent).toMatch(/expires soon.*9 days left/)
    expect(screen.getByRole("link", { name: /view license/i }).getAttribute("href")).toBe("/admin/settings/license")
  })

  test("is an alert once the license has lapsed", async () => {
    getMyLicense.mockResolvedValue(license({ state: "expired", valid: false, message: "This license has expired. Contact your administrator to renew it." }))
    show()
    expect((await screen.findByRole("alert")).textContent).toMatch(/has expired/)
  })

  test("stays silent when the license cannot be read", async () => {
    getMyLicense.mockRejectedValue(new Error("forbidden"))
    show()
    await waitFor(() => expect(getMyLicense).toHaveBeenCalled())
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()
  })
})

describe("reminder history", () => {
  test("is worded for the client and for a System Administrator", async () => {
    const { describeReminder } = await import("./licenseDisplay")
    const sent = { thresholdDays: 7, sentAt: "2026-10-02T03:00:00Z" }
    expect(describeReminder(license({ state: "expiring", daysRemaining: 6, lastReminder: sent }))).toMatch(/^7-day warning · Oct 2, 2026$/)
    expect(describeReminder(license({ state: "expiring", daysRemaining: 6, lastReminder: { ...sent, recipients: 2 } }))).toMatch(/sent to 2 administrators$/)
    expect(describeReminder(license({ state: "expiring", daysRemaining: 1, lastReminder: { ...sent, thresholdDays: 1, recipients: 1 } }))).toMatch(/^1-day warning .* sent to 1 administrator$/)
    expect(describeReminder(license({ state: "expired", valid: false, lastReminder: { ...sent, thresholdDays: 0 } }))).toMatch(/^Expired notice/)
  })

  test("says 'not due yet' far from the end, 'none sent yet' once one is due, and nothing when reminders do not apply", async () => {
    const { describeReminder } = await import("./licenseDisplay")
    expect(describeReminder(license({ daysRemaining: 200, lastReminder: null }))).toBe("Not due yet")
    expect(describeReminder(license({ state: "expiring", daysRemaining: 20, lastReminder: null }))).toBe("None sent yet")
    expect(describeReminder(license({ state: "expired", valid: false, lastReminder: null }))).toBe("None sent yet")
    expect(describeReminder(license({ perpetual: true, expiresAt: null, daysRemaining: null }))).toBeNull()
    expect(describeReminder(license({ state: "revoked", valid: false }))).toBeNull()
    expect(describeReminder({ state: "missing" })).toBeNull()
  })

  test("the license card shows it, and omits the line for a perpetual license", () => {
    const { rerender } = render(<LicenseCard license={license({ state: "expiring", daysRemaining: 6, lastReminder: { thresholdDays: 7, sentAt: "2026-10-02T03:00:00Z" } })} />)
    expect(screen.getByText("Last reminder")).toBeTruthy()
    expect(screen.getByText(/7-day warning/)).toBeTruthy()
    rerender(<LicenseCard license={license({ perpetual: true, expiresAt: null, daysRemaining: null })} />)
    expect(screen.queryByText("Last reminder")).toBeNull()
  })
})
