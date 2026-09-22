import { describe, test, expect, beforeEach, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

/**
 * My Profile and Integrations.
 *
 * My Profile is the first screen in this system where a person can change
 * something about their own account, so the cases worth pinning are the ones
 * where being wrong gives an account away: an email moved without the password,
 * or a mistyped new password saved because nobody compared the two boxes.
 */

const updateMyProfile = vi.fn()
const changeMyPassword = vi.fn()
const getMyPhoto = vi.fn()
const uploadMyPhoto = vi.fn()
const removeMyPhoto = vi.fn()
const getIntegrations = vi.fn()
const addToast = vi.fn()
const refresh = vi.fn()

vi.mock("../../../services/admin/accountService", () => ({
  updateMyProfile: (...a) => updateMyProfile(...a),
  changeMyPassword: (...a) => changeMyPassword(...a),
  getMyPhoto: (...a) => getMyPhoto(...a),
  uploadMyPhoto: (...a) => uploadMyPhoto(...a),
  removeMyPhoto: (...a) => removeMyPhoto(...a),
}))

vi.mock("../../../services/admin/settingsService", () => ({
  getIntegrations: (...a) => getIntegrations(...a),
}))

vi.mock("../../../components/shared/Toast", () => ({
  useToast: () => ({ addToast }),
}))

const USER = {
  firstName: "Ana",
  lastName: "Reyes",
  email: "ana@example.com",
  roles: [{ role_name: "Dispatcher" }],
}

vi.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: USER, refresh }),
}))

vi.mock("../../../hooks/useActiveAccess", () => ({
  default: () => ({ current: { company_name: "AstreaBlue", branch_name: "Batangas" } }),
}))

const { default: MyProfilePage } = await import("./MyProfilePage")
const { default: IntegrationsPage } = await import("./IntegrationsPage")

beforeEach(() => {
  getMyPhoto.mockResolvedValue(null)
  updateMyProfile.mockResolvedValue({ success: true, message: "Saved." })
  changeMyPassword.mockResolvedValue({ success: true, message: "Password changed." })
  getIntegrations.mockResolvedValue([
    { key: "maps", name: "Address search", state: "connected", summary: "Public geocoder", detail: "Shared and rate limited." },
    { key: "email", name: "Email", state: "absent", summary: "Not set up", detail: "The system sends no email at all." },
  ])
})

describe("My Profile", () => {
  test("there is nothing to save until something changes", async () => {
    render(<MyProfilePage />)
    const button = await screen.findByRole("button", { name: /save details/i })
    expect(button.disabled).toBe(true)
  })

  test("changing the email asks for the password, and will not save without it", async () => {
    /*
     * A token lifted from an unlocked screen must not be enough to move the
     * account to an address the owner cannot reach.
     */
    render(<MyProfilePage />)
    const email = await screen.findByLabelText(/^email$/i)

    fireEvent.change(email, { target: { value: "someone.else@example.com" } })

    expect(await screen.findByLabelText(/current password to change your email/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: /save details/i }).disabled).toBe(true)
    expect(updateMyProfile).not.toHaveBeenCalled()
  })

  test("changing only the name does not ask for a password", async () => {
    // Demanding one for a harmless change teaches people to type their
    // password into any box that asks for it.
    render(<MyProfilePage />)
    const first = await screen.findByLabelText(/first name/i)

    fireEvent.change(first, { target: { value: "Anna" } })

    const save = screen.getByRole("button", { name: /save details/i })
    await waitFor(() => expect(save.disabled).toBe(false))
    fireEvent.click(save)

    await waitFor(() =>
      expect(updateMyProfile).toHaveBeenCalledWith({
        firstName: "Anna",
        lastName: "Reyes",
        email: "ana@example.com",
      })
    )
  })

  test("two new passwords that do not match never reach the server", async () => {
    // Otherwise the person is locked out by their own typo, with no reset to
    // fall back on.
    render(<MyProfilePage />)

    fireEvent.change(await screen.findByLabelText(/^current password$/i), { target: { value: "old one here" } })
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: "a brand new phrase" } })
    fireEvent.change(screen.getByLabelText(/repeat new password/i), { target: { value: "a brand new phrsae" } })

    fireEvent.click(screen.getByRole("button", { name: /change password/i }))

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.stringMatching(/do not match/i), "error"))
    expect(changeMyPassword).not.toHaveBeenCalled()
  })

  test("a matching pair is sent and the boxes are emptied afterwards", async () => {
    render(<MyProfilePage />)

    fireEvent.change(await screen.findByLabelText(/^current password$/i), { target: { value: "old one here" } })
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: "a brand new phrase" } })
    fireEvent.change(screen.getByLabelText(/repeat new password/i), { target: { value: "a brand new phrase" } })

    fireEvent.click(screen.getByRole("button", { name: /change password/i }))

    await waitFor(() => expect(changeMyPassword).toHaveBeenCalledWith("old one here", "a brand new phrase"))
    await waitFor(() => expect(screen.getByLabelText(/^new password$/i).value).toBe(""))
  })

  test("the page says other sessions keep working, because they do", async () => {
    // The system has no way to end a token early. Implying otherwise would be
    // a false claim on a security screen.
    render(<MyProfilePage />)
    expect(await screen.findByText(/does not sign out devices that are already signed in/i)).toBeTruthy()
  })
})

describe("Integrations", () => {
  test("it reports what the server says, connected and absent alike", async () => {
    render(<IntegrationsPage />)

    expect(await screen.findByText("Address search")).toBeTruthy()
    expect(screen.getByText("Connected")).toBeTruthy()
    expect(screen.getByText("Email")).toBeTruthy()
    expect(screen.getAllByText(/not set up/i).length).toBeGreaterThan(0)
  })

  test("it does not offer to connect anything it cannot connect", async () => {
    /*
     * The page it replaces had a Connect button on all six services over a
     * line admitting none of them worked.
     */
    render(<IntegrationsPage />)
    await screen.findByText("Address search")

    expect(screen.queryByRole("button", { name: /connect/i })).toBeNull()
  })
})
