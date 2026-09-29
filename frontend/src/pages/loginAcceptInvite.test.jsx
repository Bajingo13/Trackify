import { describe, test, expect, beforeEach, vi } from "vitest"
import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"

/**
 * The emailed invitation link opens the sign-in page with the setup form in
 * the card: checked first, so a dead link says so before anything is typed,
 * and accepted with the person's own name and password.
 */

const checkInvitation = vi.fn()
const acceptInvitation = vi.fn()

vi.mock("../services/passwordResetService", () => ({
  checkInvitation: (...a) => checkInvitation(...a),
}))
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: null, login: vi.fn(), completeInitialPassword: vi.fn(), acceptInvitation, logout: vi.fn() }),
}))
vi.mock("../components/login/TrackingScene", () => ({ default: () => <div>scene</div> }))
vi.mock("../assets/astreablue-logo.png", () => ({ default: "logo.png" }))

// The card swap is animated; on a busy machine it can outlast the default 1s wait.
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 20_000 })

const { default: LoginPage } = await import("./LoginPage")

const STRONG = "Safe phrase here 7!"
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
  acceptInvitation.mockReset()
  checkInvitation.mockResolvedValue({
    data: {
      email: "paul.rosal@gmail.com", firstName: "Paul", lastName: "Rosal",
      role: "Dispatcher", companyName: "Business Set Up & Co.", inviterName: "SuperAdmin",
    },
  })
})

describe("Accepting an invitation", () => {
  test("a good link shows the setup form, prefilled, with who invited them", async () => {
    atInvite()
    expect(await screen.findByRole("heading", { name: /finish your account/i })).toBeTruthy()
    expect(checkInvitation).toHaveBeenCalledWith("abc")
    expect(screen.getByText(/superadmin invited you to trackify as dispatcher/i)).toBeTruthy()
    expect(screen.getByLabelText(/^first name$/i).value).toBe("Paul")
    const email = screen.getByLabelText(/^email address$/i)
    expect(email.value).toBe("paul.rosal@gmail.com")
    expect(email.readOnly).toBe(true)
  })

  test("accepting sends the token, the confirmed name and the password, then opens the app", async () => {
    acceptInvitation.mockResolvedValue({ success: true })
    atInvite()
    await screen.findByRole("heading", { name: /finish your account/i })
    fireEvent.change(screen.getByLabelText(/^last name$/i), { target: { value: " Rosal-Cruz " } })
    fireEvent.change(screen.getByLabelText(/^create password$/i), { target: { value: STRONG } })
    fireEvent.change(screen.getByLabelText(/^repeat password$/i), { target: { value: STRONG } })
    fireEvent.click(screen.getByRole("button", { name: /activate account/i }))

    await waitFor(() =>
      expect(acceptInvitation).toHaveBeenCalledWith("abc", { firstName: "Paul", lastName: "Rosal-Cruz", newPassword: STRONG })
    )
    expect(await screen.findByText("Dashboard")).toBeTruthy()
  })

  test("a refusal from the server stays on the card", async () => {
    acceptInvitation.mockResolvedValue({ success: false, error: "This invitation has already been used." })
    atInvite()
    await screen.findByRole("heading", { name: /finish your account/i })
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
