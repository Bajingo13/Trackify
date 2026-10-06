import { describe, test, expect, beforeEach, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

/**
 * New Client Setup collects a full client profile in short steps. Only the
 * essentials are required; optional fields that are filled in wrongly stop
 * the step, and the branch can reuse the company's address.
 */

const createClientSetup = vi.fn()
vi.mock("../../../services/admin/clientOnboardingService", () => ({
  createClientSetup: (...a) => createClientSetup(...a),
}))
vi.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ hasPermission: () => true }) }))

const { default: ClientSetupPage } = await import("./ClientSetupPage")

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const next = () => screen.getByRole("button", { name: /continue/i })
// Dropdowns are the shared listbox Select, not a native <select>: open it, then choose.
const pick = (label, option) => {
  fireEvent.click(screen.getByLabelText(label))
  fireEvent.click(screen.getByRole("option", { name: option }))
}

beforeEach(() => {
  createClientSetup.mockReset()
  createClientSetup.mockResolvedValue({
    delivery: "email", company: { companyName: "ABL Freight Inc." }, administrator: { email: "admin@abl.ph" },
    expiresAt: new Date().toISOString(),
  })
})

describe("New Client Setup", () => {
  test("only the essentials are required, and a bad optional value stops the step", () => {
    render(<ClientSetupPage />)
    expect(next().disabled).toBe(true)
    type(/registered company name/i, "ABL Freight Inc.")
    type(/company code/i, "abl")
    expect(screen.getByLabelText(/company code/i).value).toBe("ABL")
    expect(next().disabled).toBe(false)

    type(/^tin/i, "12345")
    expect(screen.getByText(/000-000-000 or/i)).toBeTruthy()
    expect(next().disabled).toBe(true)
    type(/^tin/i, "123-456-789-000")
    expect(next().disabled).toBe(false)
  })

  test("the full profile is sent, with the branch reusing the company address", async () => {
    render(<ClientSetupPage />)
    type(/registered company name/i, "ABL Freight Inc.")
    type(/company code/i, "ABL")
    pick(/business type/i, "Corporation")
    fireEvent.click(next())

    type(/company email/i, "ops@abl.ph")
    type(/street address/i, "1286 Sen. Gil Puyat Ave")
    type(/barangay/i, "San Lorenzo")
    type(/city \/ municipality/i, "Makati City")
    type(/^postal code/i, "1226")
    fireEvent.click(next())

    type(/branch name/i, "Makati Hub")
    type(/branch code/i, "MKT")
    fireEvent.click(next())

    type(/first name/i, "Maria")
    type(/last name/i, "Santos")
    type(/email address/i, "admin@abl.ph")
    fireEvent.click(next())

    pick(/payment terms/i, "Net 30")
    expect(screen.getByText("Makati Hub (MKT)")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /create client/i }))

    await waitFor(() => expect(createClientSetup).toHaveBeenCalledOnce())
    const payload = createClientSetup.mock.calls[0][0]
    expect(payload).toMatchObject({
      companyName: "ABL Freight Inc.", companyCode: "ABL", businessType: "Corporation", companyEmail: "ops@abl.ph",
      branchName: "Makati Hub", branchCode: "MKT", branchAddressLine: "1286 Sen. Gil Puyat Ave, San Lorenzo",
      branchCity: "Makati City", branchPostalCode: "1226", paymentTerms: "Net 30", email: "admin@abl.ph",
    })
    expect("branchSameAddress" in payload).toBe(false)
    // The license term travels as months (the default is one year), not as its label.
    expect(payload.licenseTermMonths).toBe(12)
    expect("licenseTerm" in payload).toBe(false)
    expect(await screen.findByText(/ABL Freight Inc\. is ready/)).toBeTruthy()
  })
})
