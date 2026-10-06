import { describe, test, expect, beforeEach, vi } from "vitest"
import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"

/**
 * The emailed invitation link opens the sign-in page with the setup form in
 * the card: checked first, so a dead link says so before anything is typed,
 * and accepted with the person's own name and password.
 */

const checkInvitation = vi.fn()
const verifyInvitation = vi.fn()
const acceptInvitation = vi.fn()
const logout = vi.fn()

vi.mock("../services/passwordResetService", () => ({
  checkInvitation: (...a) => checkInvitation(...a),
  verifyInvitation: (...a) => verifyInvitation(...a),
}))
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: null, login: vi.fn(), completeInitialPassword: vi.fn(), acceptInvitation, logout }),
}))
vi.mock("../components/login/TrackingScene", () => ({ default: () => <div>scene</div> }))
vi.mock("../assets/astreablue-logo.png", () => ({ default: "logo.png" }))

// The card swap is animated; on a busy machine it can outlast the default 1s wait.
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 20_000 })

const { default: LoginPage } = await import("./LoginPage")

const STRONG = "Safe phrase here 7!"
/* The link opens on the email check; typing the right address unlocks the form. */
async function passEmailCheck() {
  fireEvent.change(await screen.findByLabelText(/^email address$/i), { target: { value: "paul.rosal@gmail.com" } })
  fireEvent.click(screen.getByRole("button", { name: /continue/i }))
  await screen.findByRole("heading", { name: /finish your account/i })
}
const atInvite = (search = "?token=abc") =>
  render(
    <MemoryRouter initialEntries={[`/accept-invite${search}`]}>
      <Routes>
        <Route path="/accept-invite" element={<LoginPage />} />
        <Route path="/login" element={<div>Sign in screen</div>} />
        <Route path="/dashboard" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(() => {
  localStorage.clear()
  checkInvitation.mockReset()
  verifyInvitation.mockReset()
  acceptInvitation.mockReset()
  logout.mockReset()
  checkInvitation.mockResolvedValue({ data: { maskedEmail: "p•••@gmail.com", attemptsLeft: 5 } })
  verifyInvitation.mockResolvedValue({
    data: {
      email: "paul.rosal@gmail.com", firstName: "Paul", lastName: "Rosal",
      role: "Dispatcher", companyName: "Business Set Up & Co.", inviterName: "SuperAdmin",
    },
  })
})

describe("Accepting an invitation", () => {
  test("a good link shows only a masked address until the full one is typed", async () => {
    atInvite()
    expect(await screen.findByRole("heading", { name: /confirm it’s you/i })).toBeTruthy()
    expect(screen.getByText("p•••@gmail.com")).toBeTruthy()
    expect(screen.queryByText(/superadmin/i)).toBeNull()
    expect(screen.queryByLabelText(/^first name$/i)).toBeNull()
  })

  test("a wrong address stays on the check and says it was refused", async () => {
    verifyInvitation.mockRejectedValue(Object.assign(new Error("That isn't the email address this invitation was sent to. 4 attempts left."), { status: 403 }))
    atInvite()
    fireEvent.change(await screen.findByLabelText(/^email address$/i), { target: { value: "someone@else.com" } })
    fireEvent.click(screen.getByRole("button", { name: /continue/i }))
    expect(await screen.findByText(/isn't the email address/i)).toBeTruthy()
    expect(screen.queryByRole("heading", { name: /finish your account/i })).toBeNull()
  })

  test("a locked link ends on the dead-link card", async () => {
    verifyInvitation.mockRejectedValue(Object.assign(new Error("Too many incorrect attempts, so this invitation was locked."), { status: 423 }))
    atInvite()
    fireEvent.change(await screen.findByLabelText(/^email address$/i), { target: { value: "someone@else.com" } })
    fireEvent.click(screen.getByRole("button", { name: /continue/i }))
    expect(await screen.findByRole("heading", { name: /can’t be used/i })).toBeTruthy()
    expect(screen.getByText(/locked/i)).toBeTruthy()
  })

  test("the right address shows the setup form, prefilled, with who invited them", async () => {
    atInvite()
    await passEmailCheck()
    expect(verifyInvitation).toHaveBeenCalledWith("abc", "paul.rosal@gmail.com")
    expect(checkInvitation).toHaveBeenCalledWith("abc")
    expect(screen.getByText(/superadmin invited you to trackify as dispatcher/i)).toBeTruthy()
    expect(screen.getByLabelText(/^first name$/i).value).toBe("Paul")
    const email = screen.getByLabelText(/^email address$/i)
    expect(email.value).toBe("paul.rosal@gmail.com")
    expect(email.readOnly).toBe(true)
  })

  test("accepting sends the token and the password, welcomes them, then sends them back to sign in to verify the account", async () => {
    acceptInvitation.mockResolvedValue({ success: true })
    atInvite()
    await passEmailCheck()
    fireEvent.change(screen.getByLabelText(/^last name$/i), { target: { value: " Rosal-Cruz " } })
    fireEvent.change(screen.getByLabelText(/^create password$/i), { target: { value: STRONG } })
    fireEvent.change(screen.getByLabelText(/^repeat password$/i), { target: { value: STRONG } })
    fireEvent.click(screen.getByRole("button", { name: /activate account/i }))

    await waitFor(() =>
      expect(acceptInvitation).toHaveBeenCalledWith("abc", { email: "paul.rosal@gmail.com", firstName: "Paul", lastName: "Rosal-Cruz", newPassword: STRONG })
    )
    // The session the acceptance created is not kept — the account is only
    // confirmed once they sign back in with the password they just set.
    expect(logout).toHaveBeenCalled()
    expect(await screen.findByText(/account is ready/i)).toBeTruthy()
    expect(await screen.findByText("Sign in screen")).toBeTruthy()
  })

  test("a refusal from the server stays on the card", async () => {
    acceptInvitation.mockResolvedValue({ success: false, error: "This invitation has already been used." })
    atInvite()
    await passEmailCheck()
    fireEvent.change(screen.getByLabelText(/^create password$/i), { target: { value: STRONG } })
    fireEvent.change(screen.getByLabelText(/^repeat password$/i), { target: { value: STRONG } })
    fireEvent.click(screen.getByRole("button", { name: /activate account/i }))

    expect(await screen.findByText(/already been used/i)).toBeTruthy()
  })

  test("a dead link says so up front and offers the way to sign in", async () => {
    checkInvitation.mockRejectedValue(new Error("This invitation has expired or was replaced by a newer one."))
    atInvite()
    expect(await screen.findByRole("heading", { name: /can’t be used/i })).toBeTruthy()
    expect(screen.getByText(/expired or was replaced/i)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /go to sign in/i }))
    expect(await screen.findByText("Sign in screen")).toBeTruthy()
  })

  test("a link with no token never asks the server", async () => {
    atInvite("")
    expect(await screen.findByText(/link is incomplete/i)).toBeTruthy()
    expect(checkInvitation).not.toHaveBeenCalled()
  })
})
