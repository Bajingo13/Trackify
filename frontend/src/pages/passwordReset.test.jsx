import { describe, test, expect, beforeEach, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"

/**
 * The two screens a locked-out person sees.
 *
 * These are reached by somebody who cannot sign in, often anxious and often on
 * a phone. The cases that matter are the ones where the screen would mislead
 * them: an expired link that only says so after they have typed a new password
 * twice, or a confirmation that implies an email went somewhere it did not.
 */

const requestPasswordReset = vi.fn()
const checkResetToken = vi.fn()
const completePasswordReset = vi.fn()

vi.mock("../services/passwordResetService", () => ({
  requestPasswordReset: (...a) => requestPasswordReset(...a),
  checkResetToken: (...a) => checkResetToken(...a),
  completePasswordReset: (...a) => completePasswordReset(...a),
}))

vi.mock("../assets/astreablue-logo.png", () => ({ default: "logo.png" }))

const { default: ForgotPasswordPage } = await import("./ForgotPasswordPage")
const { default: ResetPasswordPage } = await import("./ResetPasswordPage")

const atReset = (search) =>
  render(
    <MemoryRouter initialEntries={[`/reset-password${search}`]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<div>Sign in screen</div>} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(() => {
  requestPasswordReset.mockResolvedValue({ success: true, message: "on its way" })
  checkResetToken.mockResolvedValue({ success: true, data: { email: "a•••@example.com" } })
  completePasswordReset.mockResolvedValue({ success: true })
})

describe("Asking for a link", () => {
  test("the confirmation does not confirm the address exists", async () => {
    /*
     * The server answers the same way for every address on purpose. If this
     * screen said "we sent it to you", it would give away exactly what the
     * server refuses to.
     */
    render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "who@example.com" } })
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }))

    const note = await screen.findByText(/if that address belongs to an account/i)
    expect(note).toBeTruthy()
    expect(screen.queryByText(/we sent it to who@example.com/i)).toBeNull()
  })

  test("a server that cannot send mail says so instead of saying check your email", async () => {
    // The 503 the backend returns when SMTP is not configured. Telling
    // somebody to check an inbox nothing was sent to is the worst outcome.
    requestPasswordReset.mockRejectedValue(
      Object.assign(new Error("Password reset by email is not available on this server yet."), { status: 503 })
    )
    render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "who@example.com" } })
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }))

    expect(await screen.findByText(/not available on this server yet/i)).toBeTruthy()
    expect(screen.queryByText(/if that address belongs to an account/i)).toBeNull()
  })
})

describe("Using a link", () => {
  test("a dead link says so before anything is typed", async () => {
    /*
     * Finding out after carefully typing a new password twice, and being sent
     * back to the start, is the version of this screen that makes people give
     * up and call somebody.
     */
    checkResetToken.mockRejectedValue(
      Object.assign(new Error("This reset link has expired or has already been used."), { status: 410 })
    )
    atReset("?token=stale")

    expect(await screen.findByText(/this link has expired/i)).toBeTruthy()
    expect(screen.queryByLabelText(/new password/i)).toBeNull()
    expect(screen.getByText(/your password has not been changed/i)).toBeTruthy()
  })

  test("a link with no token at all is refused without asking the server", async () => {
    atReset("")

    expect(await screen.findByText(/this link has expired/i)).toBeTruthy()
    expect(checkResetToken).not.toHaveBeenCalled()
  })

  test("a good link shows the form, masked to the right account", async () => {
    atReset("?token=good")

    expect(await screen.findByLabelText(/^new password$/i)).toBeTruthy()
    expect(screen.getByText(/a•••@example\.com/)).toBeTruthy()
  })

  test("two passwords that do not match never reach the server", async () => {
    atReset("?token=good")

    fireEvent.change(await screen.findByLabelText(/^new password$/i), { target: { value: "a new passphrase" } })
    fireEvent.change(screen.getByLabelText(/repeat new password/i), { target: { value: "a new passphrasee" } })
    fireEvent.click(screen.getByRole("button", { name: /change my password/i }))

    expect(await screen.findByText(/do not match/i)).toBeTruthy()
    expect(completePasswordReset).not.toHaveBeenCalled()
  })

  test("a refused password keeps the form open, because the link is still good", async () => {
    // The server does not consume the link when the password breaks a rule,
    // so the screen must not behave as though it did.
    completePasswordReset.mockRejectedValue(
      Object.assign(new Error("Use at least 10 characters."), { status: 400 })
    )
    atReset("?token=good")

    fireEvent.change(await screen.findByLabelText(/^new password$/i), { target: { value: "short" } })
    fireEvent.change(screen.getByLabelText(/repeat new password/i), { target: { value: "short" } })
    fireEvent.click(screen.getByRole("button", { name: /change my password/i }))

    expect(await screen.findByText(/at least 10 characters/i)).toBeTruthy()
    expect(screen.getByLabelText(/^new password$/i)).toBeTruthy()
  })

  test("a link the server rejects mid-flow closes the form", async () => {
    completePasswordReset.mockRejectedValue(
      Object.assign(new Error("This reset link has expired or has already been used."), { status: 410 })
    )
    atReset("?token=good")

    fireEvent.change(await screen.findByLabelText(/^new password$/i), { target: { value: "a new passphrase" } })
    fireEvent.change(screen.getByLabelText(/repeat new password/i), { target: { value: "a new passphrase" } })
    fireEvent.click(screen.getByRole("button", { name: /change my password/i }))

    expect(await screen.findByText(/this link has expired/i)).toBeTruthy()
    expect(screen.queryByLabelText(/^new password$/i)).toBeNull()
  })

  test("success says a confirmation was emailed and what to do if it was not you", async () => {
    atReset("?token=good")

    fireEvent.change(await screen.findByLabelText(/^new password$/i), { target: { value: "a new passphrase" } })
    fireEvent.change(screen.getByLabelText(/repeat new password/i), { target: { value: "a new passphrase" } })
    fireEvent.click(screen.getByRole("button", { name: /change my password/i }))

    await waitFor(() => expect(completePasswordReset).toHaveBeenCalledWith("good", "a new passphrase"))
    expect(await screen.findByText(/password changed/i)).toBeTruthy()
    expect(screen.getByText(/tell your administrator/i)).toBeTruthy()
  })
})
