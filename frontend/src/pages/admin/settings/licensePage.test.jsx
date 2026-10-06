import { describe, test, expect, beforeEach, vi } from "vitest"
import { render, screen, within, waitFor } from "@testing-library/react"

/**
 * The License screen: everyone sees their own license; a System Administrator
 * also gets the table of every client's license, with each one's reminder
 * history beside it.
 */

const getMyLicense = vi.fn()
const listLicenses = vi.fn()
let isSystemAdmin = true
vi.mock("../../../services/admin/licenseService", () => ({
  getMyLicense: (...a) => getMyLicense(...a),
  listLicenses: (...a) => listLicenses(...a),
  renewLicense: vi.fn(), revokeLicense: vi.fn(), reinstateLicense: vi.fn(),
}))
vi.mock("../../../auth/permissions", () => ({ usePermissions: () => ({ isSystemAdmin }) }))
vi.mock("../../../components/shared/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }))

const { default: LicensePage } = await import("./LicensePage")

const base = {
  systemCode: "TRK01", valid: true, perpetual: false, issuedAt: "2026-01-01T00:00:00Z", message: null,
}
const mine = { ...base, licenseId: 1, companyId: 1, licenseNumber: "TRK01-ACME-2026-AAAAAAAAAA", state: "active", status: "active", expiresAt: "2027-01-01T00:00:00Z", daysRemaining: 200, lastReminder: null, enforced: false }
const rows = [
  { ...mine, companyName: "ACME Freight", companyCode: "ACME" },
  { ...base, licenseId: 2, companyId: 2, companyName: "Beta Haulers", companyCode: "BETA", licenseNumber: "TRK01-BETA-2026-BBBBBBBBBB", state: "expiring", status: "active", expiresAt: "2026-10-12T12:00:00Z", daysRemaining: 6, lastReminder: { thresholdDays: 7, sentAt: "2026-10-05T03:00:00Z", recipients: 2 } },
  { ...base, licenseId: 3, companyId: 3, companyName: "Gamma Cargo", companyCode: "GAMA", licenseNumber: "TRK01-GAMA-2026-CCCCCCCCCC", state: "expired", valid: false, status: "active", expiresAt: "2026-09-30T00:00:00Z", daysRemaining: 0, lastReminder: null },
  { ...base, licenseId: 4, companyId: 4, companyName: "Delta Moves", companyCode: "DLTA", licenseNumber: "TRK01-DLTA-2026-DDDDDDDDDD", state: "active", status: "active", perpetual: true, expiresAt: null, daysRemaining: null, lastReminder: null },
]

beforeEach(() => {
  isSystemAdmin = true
  getMyLicense.mockReset().mockResolvedValue(mine)
  listLicenses.mockReset().mockResolvedValue(rows)
})

describe("License page", () => {
  test("a System Administrator sees each client's reminder history in the table", async () => {
    render(<LicensePage />)
    const beta = (await screen.findByText("Beta Haulers")).closest("tr")
    // What was sent on the first line; when and to whom beneath it.
    expect(within(beta).getByText("7-day warning")).toBeTruthy()
    expect(within(beta).getByText("Oct 5, 2026 · sent to 2 administrators")).toBeTruthy()
    // The end date and time left sit with the status, so there is no separate "Valid until" column.
    expect(within(beta).getByText(/6 days left · until Oct 12, 2026/)).toBeTruthy()
    const gamma = screen.getByText("Gamma Cargo").closest("tr")
    expect(within(gamma).getByText("None sent yet")).toBeTruthy()
    const acme = screen.getByText("ACME Freight").closest("tr")
    expect(within(acme).getByText("Not due yet")).toBeTruthy()
    const delta = screen.getByText("Delta Moves").closest("tr")
    expect(within(delta).queryByText(/reminder|warning|due|sent/i)).toBeNull()
  })

  test("a client sees only its own license, with no all-clients table", async () => {
    isSystemAdmin = false
    getMyLicense.mockResolvedValue({ ...mine, state: "expiring", daysRemaining: 6, lastReminder: { thresholdDays: 7, sentAt: "2026-10-05T03:00:00Z" } })
    render(<LicensePage />)
    expect(await screen.findByTestId("license-number")).toBeTruthy()
    expect(screen.getByText("Last reminder")).toBeTruthy()
    expect(screen.getByText("7-day warning sent")).toBeTruthy()
    expect(screen.getByText("Oct 5, 2026")).toBeTruthy()
    expect(screen.queryByText(/sent to/)).toBeNull()
    expect(screen.queryByText("All client licenses")).toBeNull()
    expect(listLicenses).not.toHaveBeenCalled()
  })

  test("the status chips filter the table and show counts", async () => {
    render(<LicensePage />)
    await screen.findByText("Beta Haulers")
    const group = screen.getByRole("group", { name: /filter by license status/i })
    expect(within(group).getByRole("button", { name: /all 4/i })).toBeTruthy()
    within(group).getByRole("button", { name: /expiring soon 1/i }).click()
    await waitFor(() => expect(screen.queryByText("Gamma Cargo")).toBeNull())
    expect(screen.getByText("Beta Haulers")).toBeTruthy()
  })
})
