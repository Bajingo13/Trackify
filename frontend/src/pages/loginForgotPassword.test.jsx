import { describe, test, expect, beforeEach, vi } from "vitest"
import { configure, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"

/**
 * "Forgot password?" swaps the sign-in card to the reset-link form in place:
 * the page around it, and the address bar, stay where they are.
 */

const requestPasswordReset = vi.fn()

vi.mock("../services/passwordResetService", () => ({
  requestPasswordReset: (...a) => requestPasswordReset(...a),
}))
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ login: vi.fn() }) }))
vi.mock("../components/login/TrackingScene", () => ({ default: () => <div>scene</div> }))
vi.mock("../assets/astreablue-logo.png", () => ({ default: "logo.png" }))

// The card swap is animated; on a busy machine it can outlast the default 1s wait.
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 20_000 })

const { default: LoginPage } = await import("./LoginPage")

const atLogin = () =>
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<div>Separate forgot page</div>} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(() => {
  localStorage.clear()
  requestPasswordReset.mockReset()
  requestPasswordReset.mockResolvedValue({ success: true })
})

describe("Forgot password on the sign-in page", () => {
  test("swaps the card in place and carries the typed email over", async () => {
    atLogin()
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "who@example.com" } })
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }))

    expect(await screen.findByRole("heading", { name: /forgot your password/i })).toBeTruthy()
    expect(screen.getByLabelText(/email address/i).value).toBe("who@example.com")
    // Same page: the hero is still there and the other route was never visited.
    expect(screen.getByRole("heading", { name: /every trip/i })).toBeTruthy()
    expect(screen.queryByText("Separate forgot page")).toBeNull()
  })

  test("sends the link and confirms without confirming the address exists", async () => {
    atLogin()
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }))
    await screen.findByRole("heading", { name: /forgot your password/i })
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "who@example.com" } })
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }))

    expect(await screen.findByText(/if that address belongs to an account/i)).toBeTruthy()
    expect(requestPasswordReset).toHaveBeenCalledWith("who@example.com")
  })

  test("back returns to the sign-in form", async () => {
    atLogin()
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }))
    fireEvent.click(await screen.findByRole("button", { name: /back to sign in/i }))

    expect(await screen.findByRole("heading", { name: /sign in to continue/i })).toBeTruthy()
    expect(screen.getByLabelText(/^password$/i)).toBeTruthy()
  })
})
