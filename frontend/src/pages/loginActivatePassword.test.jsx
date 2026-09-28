import { describe, test, expect, beforeEach, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

/**
 * A temporary password is replaced on the sign-in page's own card: the page
 * around it stays, and the card offers nothing but the permanent-password form
 * (or signing out) until that succeeds.
 */

const completeInitialPassword = vi.fn()
const logout = vi.fn()
let user = null

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user, login: vi.fn(), completeInitialPassword, logout }),
}))
vi.mock("../components/login/TrackingScene", () => ({ default: () => <div>scene</div> }))
vi.mock("../assets/astreablue-logo.png", () => ({ default: "logo.png" }))

const { default: LoginPage } = await import("./LoginPage")

const atLogin = () => render(<MemoryRouter><LoginPage /></MemoryRouter>)

beforeEach(() => {
  localStorage.clear()
  user = { email: "new.user@example.com", mustChangePassword: true }
  completeInitialPassword.mockReset()
  logout.mockReset()
})

describe("Permanent password on the sign-in page", () => {
  test("the card asks for a permanent password and the page stays", () => {
    atLogin()
    expect(screen.getByRole("heading", { name: /create your permanent password/i })).toBeTruthy()
    expect(screen.getByText("new.user@example.com")).toBeTruthy()
    expect(screen.getByRole("heading", { name: /every trip/i })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /sign in securely/i })).toBeNull()
  })

  test("a mismatched confirmation never reaches the activation endpoint", () => {
    atLogin()
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: "a safe phrase here" } })
    fireEvent.change(screen.getByLabelText(/repeat new password/i), { target: { value: "a different phrase" } })
    fireEvent.click(screen.getByRole("button", { name: /activate account/i }))

    expect(screen.getByRole("alert").textContent).toMatch(/do not match/i)
    expect(completeInitialPassword).not.toHaveBeenCalled()
  })

  test("matching values are sent once, and a refusal is shown on the card", async () => {
    completeInitialPassword.mockResolvedValueOnce({ success: false, error: "Choose a password you have not used here." })
    atLogin()
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: "a safe phrase here" } })
    fireEvent.change(screen.getByLabelText(/repeat new password/i), { target: { value: "a safe phrase here" } })
    fireEvent.click(screen.getByRole("button", { name: /activate account/i }))

    await waitFor(() => expect(completeInitialPassword).toHaveBeenCalledWith("a safe phrase here"))
    expect(await screen.findByText(/have not used here/i)).toBeTruthy()
  })

  test("using a different account signs out", () => {
    atLogin()
    fireEvent.click(screen.getByRole("button", { name: /use a different account/i }))
    expect(logout).toHaveBeenCalledOnce()
  })

  test("an account that is already activated sees the sign-in form", () => {
    user = null
    atLogin()
    expect(screen.getByRole("heading", { name: /sign in to continue/i })).toBeTruthy()
  })
})
