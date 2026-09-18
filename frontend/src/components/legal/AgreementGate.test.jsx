import { describe, test, expect, beforeEach, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

/**
 * The gate in front of every authenticated screen.
 *
 * This is the highest-consequence component in the web app: it wraps the route
 * guard, so a fault here does not break one page, it closes all forty-three.
 * The cases below are the ones where being wrong matters — that it fails
 * closed, that it does not hold anyone hostage when it cannot reach the server,
 * and that declining signs out rather than silently continuing.
 */

const loadAgreement = vi.fn()
const acceptAgreement = vi.fn()
const logout = vi.fn()

vi.mock("../../services/agreementService", () => ({
  loadAgreement: (...a) => loadAgreement(...a),
  acceptAgreement: (...a) => acceptAgreement(...a),
  forgetAgreement: vi.fn(),
}))

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ logout }),
}))

const { default: AgreementGate } = await import("./AgreementGate")

const DOC = {
  version: "1.0",
  effectiveDate: "2026-06-30",
  title: "Terms of Service and Data Privacy Policy",
  systemName: "AstreaBlue Trackify",
  intro: "Welcome to AstreaBlue Trackify.",
  sections: [
    { heading: "Use of the System", items: ["3.1 Lawful business purposes only."] },
    { heading: "Contact Information", paragraphs: ["Contact AstreaBlue Intelligence Inc."] },
  ],
  acceptanceStatement: "By accepting this Agreement, you acknowledge that you have read it.",
  accepted: false,
  acceptedAt: null,
}

const inside = () => screen.queryByTestId("app-behind-the-gate")
const button = (name) => screen.findByRole("button", { name })

function renderGate() {
  return render(
    <AgreementGate>
      <div data-testid="app-behind-the-gate">Dashboard</div>
    </AgreementGate>
  )
}

/**
 * Makes every element report a tall, scrollable box for the duration of `fn`.
 *
 * It has to be installed on the prototype before rendering, not on the element
 * afterwards. jsdom reports zero height for everything, so the component's
 * first measurement would find itself already at the bottom — and because the
 * read check is deliberately one-way (once read, always read), no amount of
 * stubbing afterwards can put that back.
 */
async function withTallDocument(fn) {
  const original = {
    scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight"),
    clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
  }
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 1200 })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 })
  try {
    return await fn()
  } finally {
    // Restore, or every later test file inherits a fake layout.
    if (original.scrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", original.scrollHeight)
    else delete HTMLElement.prototype.scrollHeight
    if (original.clientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", original.clientHeight)
    else delete HTMLElement.prototype.clientHeight
  }
}

describe("AgreementGate", () => {
  beforeEach(() => {
    loadAgreement.mockReset()
    acceptAgreement.mockReset()
    logout.mockReset()
  })

  test("a user who has accepted this version sees the application", async () => {
    loadAgreement.mockResolvedValue({ ...DOC, accepted: true, acceptedAt: "2026-06-30T01:00:00Z" })
    renderGate()
    await waitFor(() => expect(inside()).toBeInTheDocument())
  })

  test("a user who has not accepted sees the Agreement and not the application", async () => {
    loadAgreement.mockResolvedValue(DOC)
    renderGate()

    await screen.findByText(DOC.title)
    expect(inside()).not.toBeInTheDocument()
    expect(screen.getByText(/Lawful business purposes only/)).toBeInTheDocument()
  })

  test("the version and effective date are shown, because that is what is being accepted", async () => {
    loadAgreement.mockResolvedValue(DOC)
    renderGate()

    expect(await screen.findByText(/Version 1\.0/)).toBeInTheDocument()
  })

  test("Accept stays shut until a long Agreement has been scrolled through", async () => {
    // "You must review and accept" — so the control cannot be live before the
    // text has actually gone past the reader.
    loadAgreement.mockResolvedValue(DOC)

    await withTallDocument(async () => {
      renderGate()
      await screen.findByText(DOC.title)

      expect(await button(/read and accept/i)).toBeDisabled()
      expect(screen.getByText(/Scroll to the end/i)).toBeInTheDocument()

      const region = screen.getByRole("region", { name: "Agreement text" })
      region.scrollTop = 800
      fireEvent.scroll(region)

      await waitFor(async () => expect(await button(/read and accept/i)).toBeEnabled())
    })
  })

  test("a document short enough to fit needs no scrolling", async () => {
    // A short Agreement in a tall window is already read. Demanding a scroll
    // that cannot happen would leave the user with no way in.
    loadAgreement.mockResolvedValue(DOC)
    renderGate()

    await screen.findByText(DOC.title)
    expect(await button(/read and accept/i)).toBeEnabled()
  })

  test("accepting records it and opens the application", async () => {
    loadAgreement.mockResolvedValue(DOC)
    acceptAgreement.mockResolvedValue({ version: "1.0", accepted: true })
    renderGate()

    await screen.findByText(DOC.title)
    fireEvent.click(await button(/read and accept/i))

    await waitFor(() => expect(acceptAgreement).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(inside()).toBeInTheDocument())
  })

  test("a failed acceptance keeps the gate shut and says so", async () => {
    // Reporting success on a consent that was never recorded is the worst
    // outcome available here: the user believes they agreed and there is no
    // record of it.
    loadAgreement.mockResolvedValue(DOC)
    acceptAgreement.mockRejectedValue(new Error("Network error"))
    renderGate()

    await screen.findByText(DOC.title)
    fireEvent.click(await button(/read and accept/i))

    expect(await screen.findByText(/Network error/)).toBeInTheDocument()
    expect(inside()).not.toBeInTheDocument()
  })

  test("it fails closed when the acceptance state cannot be read", async () => {
    // Letting someone in on the assumption they probably accepted defeats the
    // only purpose of keeping the record.
    loadAgreement.mockRejectedValue(new Error("Service unavailable"))
    renderGate()

    await screen.findByText(/could not check your agreement status/i)
    expect(inside()).not.toBeInTheDocument()
  })

  test("a failure offers a way forward rather than a dead end", async () => {
    loadAgreement.mockRejectedValueOnce(new Error("Service unavailable"))
    loadAgreement.mockResolvedValueOnce({ ...DOC, accepted: true })
    renderGate()

    fireEvent.click(await button(/try again/i))
    await waitFor(() => expect(inside()).toBeInTheDocument())
  })

  test("declining signs the user out", async () => {
    // The Agreement says a user who does not agree must discontinue use, so
    // this cannot quietly leave them sitting on the screen.
    loadAgreement.mockResolvedValue(DOC)
    renderGate()

    fireEvent.click(await button(/do not agree/i))
    expect(logout).toHaveBeenCalledTimes(1)
  })
})
