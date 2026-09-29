import { describe, test, expect, beforeEach, vi } from "vitest"
import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

/**
 * First-time account setup happens on the sign-in page's own card: the page
 * around it stays, and the card offers nothing but the setup form (or signing
 * out) until it succeeds. Activate stays disabled until every field is valid.
 */

const completeInitialPassword = vi.fn()
const logout = vi.fn()
let user = null

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user, login: vi.fn(), completeInitialPassword, logout }),
}))
vi.mock("../components/login/TrackingScene", () => ({ default: () => <div>scene</div> }))
vi.mock("../assets/astreablue-logo.png", () => ({ default: "logo.png" }))

// The card swap is animated; on a busy machine it can outlast the default 1s wait.
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 20_000 })

const { default: LoginPage } = await import("./LoginPage")

const STRONG = "Safe phrase here 7!"
const atLogin = () => render(<MemoryRouter><LoginPage /></MemoryRouter>)
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const activate = () => screen.getByRole("button", { name: /activate account/i })

beforeEach(() => {
  localStorage.clear()
  user = { email: "new.user@astreablue.com", firstName: "Maria", lastName: "Santos", mustChangePassword: true }
  completeInitialPassword.mockReset()
  logout.mockReset()
})

describe("First-time account setup on the sign-in page", () => {
  test("the card shows the setup form, prefilled, and the page stays", () => {
    atLogin()
    expect(screen.getByRole("heading", { name: /finish your account/i })).toBeTruthy()
    expect(screen.getByLabelText(/^first name$/i).value).toBe("Maria")
    expect(screen.getByLabelText(/^last name$/i).value).toBe("Santos")
    // The sign-in address is shown but cannot be edited, whatever its domain.
    const email = screen.getByLabelText(/^email address$/i)
    expect(email.value).toBe("new.user@astreablue.com")
    expect(email.readOnly).toBe(true)
    // Setup is the card alone: no marketing column, but the brand bar stays.
    expect(screen.queryByRole("heading", { name: /every trip/i })).toBeNull()
    expect(screen.getByAltText("AstreaBlue")).toBeTruthy()
    expect(screen.getByText(/trip ticket/i)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /sign in securely/i })).toBeNull()
  })

  test("each password requirement turns on as it is met, and activate waits for all of them", () => {
    atLogin()
    const list = screen.getByRole("list", { name: /password requirements/i })
    const met = () => [...list.querySelectorAll("li.is-met")].map((li) => li.firstChild.nextSibling.textContent)

    type(/^create password$/i, "phrase")
    expect(met()).toEqual(["Lowercase letter"])
    type(/^create password$/i, "Phrase here 7")
    expect(met()).toEqual(["10+ characters", "Uppercase letter", "Lowercase letter", "Number"])
    type(/^repeat password$/i, "Phrase here 7")
    expect(activate().disabled).toBe(true)
    expect(screen.getByText(/to continue, add a password that meets every requirement/i)).toBeTruthy()

    type(/^create password$/i, STRONG)
    expect(met()).toHaveLength(5)
  })

  test("a mismatch is called out, a match is confirmed, and only a match enables activate", () => {
    atLogin()
    type(/^create password$/i, STRONG)
    type(/^repeat password$/i, "Safe phrase here 8!")
    expect(screen.getByText(/passwords don’t match/i)).toBeTruthy()
    expect(activate().disabled).toBe(true)

    type(/^repeat password$/i, STRONG)
    expect(screen.getByText(/^passwords match$/i)).toBeTruthy()
    expect(activate().disabled).toBe(false)
  })

  test("an emptied name is flagged once left, and blocks activation", () => {
    atLogin()
    type(/^create password$/i, STRONG)
    type(/^repeat password$/i, STRONG)
    type(/^first name$/i, "   ")
    fireEvent.blur(screen.getByLabelText(/^first name$/i))

    expect(screen.getByText(/enter your first name/i)).toBeTruthy()
    expect(activate().disabled).toBe(true)
  })

  test("the password and the confirmed name are sent once, and a refusal shows on the card", async () => {
    completeInitialPassword.mockResolvedValueOnce({ success: false, error: "Choose a password you have not used here." })
    atLogin()
    type(/^first name$/i, "  María ")
    type(/^create password$/i, STRONG)
    type(/^repeat password$/i, STRONG)
    fireEvent.click(activate())

    await waitFor(() =>
      expect(completeInitialPassword).toHaveBeenCalledWith(STRONG, { firstName: "María", lastName: "Santos" })
    )
    expect(completeInitialPassword).toHaveBeenCalledOnce()
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
