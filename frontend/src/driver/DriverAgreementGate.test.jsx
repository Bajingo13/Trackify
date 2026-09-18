import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  load: vi.fn(),
  accept: vi.fn(),
}))

vi.mock("./driverApi", () => ({
  driverAgreement: (...args) => state.load(...args),
  driverAcceptAgreement: (...args) => state.accept(...args),
}))

const { default: DriverAgreementGate } = await import("./DriverAgreementGate")

/**
 * The Driver App's agreement gate.
 *
 * What matters here is what happens when things go wrong, because the failure
 * that would be invisible is the app opening anyway: a driver's location is
 * collected under a consent basis, so "we could not check" has to mean "not
 * open", never "assume yes".
 */

const doc = (accepted) => ({
  accepted,
  title: "Terms of Service and Data Privacy Policy",
  systemName: "AstreaBlue Trackify",
  version: "1.3",
  intro: "Welcome to AstreaBlue Trackify.",
  acceptanceStatement: "By accepting this Agreement, you acknowledge…",
  sections: [{ heading: "Data Privacy", items: ["4.1.1 Driver Location Data…"] }],
})

/*
 * jsdom reports every element as zero-height, so the scroll-to-end check would
 * never pass on its own and Accept would stay disabled forever. These stubs
 * make the document either fully visible or taller than its box.
 *
 * Captured before anything is stubbed, and put back after every test. A file
 * that leaves a fake layout on the prototype hands every later test a window
 * that is not the one it asked for.
 */
const ORIGINAL = {
  scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight"),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
  scrollTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop"),
}

function setScroll({ fits }) {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, value: fits ? 100 : 5000 })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 100 })
  Object.defineProperty(HTMLElement.prototype, "scrollTop", { configurable: true, writable: true, value: 0 })
}

function restoreScroll() {
  for (const [name, descriptor] of Object.entries(ORIGINAL)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
    else delete HTMLElement.prototype[name]
  }
}

/**
 * Clicks Accept once it is actually clickable.
 *
 * Finding the button only proves it exists — the effect that measures the text
 * and enables it has not necessarily run yet, and a click on a disabled button
 * does nothing at all. Waiting for presence alone made these tests a race that
 * passed alone and lost under the full suite's parallel load.
 */
async function clickAccept() {
  const accept = await screen.findByText("I have read and accept")
  await waitFor(() => expect(accept).toBeEnabled())
  fireEvent.click(accept)
  return accept
}

const gate = (onDecline = vi.fn()) =>
  render(
    <DriverAgreementGate onDecline={onDecline}>
      <div>Today&rsquo;s trips</div>
    </DriverAgreementGate>
  )

describe("DriverAgreementGate", () => {
  beforeEach(() => {
    state.load.mockReset()
    state.accept.mockReset().mockResolvedValue({ accepted: true })
    setScroll({ fits: true })
  })

  afterEach(restoreScroll)

  it("opens the app when this version is already accepted", async () => {
    state.load.mockResolvedValue(doc(true))
    gate()

    expect(await screen.findByText("Today’s trips")).toBeTruthy()
  })

  it("does not open the app when the check fails — it fails closed", async () => {
    state.load.mockRejectedValue(new Error("Can't reach Trackify."))
    gate()

    await screen.findByText(/Can’t check your agreement/)
    // The whole point: no trip list behind the error.
    expect(screen.queryByText("Today’s trips")).toBeNull()
  })

  it("retries the check without making the driver sign in again", async () => {
    state.load.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(doc(true))
    gate()

    fireEvent.click(await screen.findByText("Try again"))
    expect(await screen.findByText("Today’s trips")).toBeTruthy()
  })

  it("shows the document and holds the app closed until it is accepted", async () => {
    state.load.mockResolvedValue(doc(false))
    gate()

    expect(await screen.findByText("Terms of Service and Data Privacy Policy")).toBeTruthy()
    expect(screen.getByText(/4.1.1 Driver Location Data/)).toBeTruthy()
    expect(screen.queryByText("Today’s trips")).toBeNull()
  })

  it("records the acceptance and then opens the app", async () => {
    state.load.mockResolvedValue(doc(false))
    gate()

    await clickAccept()

    await waitFor(() => expect(state.accept).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("Today’s trips")).toBeTruthy()
    // Nothing is sent: the server decides which version was accepted.
    expect(state.accept).toHaveBeenCalledWith()
  })

  it("keeps the app closed when the acceptance cannot be saved", async () => {
    // Reporting success on a consent that was never recorded is the worst
    // outcome available here: the driver believes they agreed and there is no
    // record of it.
    state.load.mockResolvedValue(doc(false))
    state.accept.mockRejectedValue(new Error("No signal."))
    gate()

    await clickAccept()

    expect(await screen.findByText("No signal.")).toBeTruthy()
    expect(screen.queryByText("Today’s trips")).toBeNull()
  })

  it("will not accept until the document has been scrolled through", async () => {
    setScroll({ fits: false })
    state.load.mockResolvedValue(doc(false))
    gate()

    const accept = await screen.findByText("I have read and accept")
    expect(accept).toBeDisabled()
    expect(screen.getByText("Scroll to the end to continue.")).toBeTruthy()

    const region = screen.getByRole("region", { name: "Agreement text" })
    region.scrollTop = 5000
    fireEvent.scroll(region)

    await waitFor(() => expect(accept).toBeEnabled())
  })

  it("signs out when the driver does not agree", async () => {
    const onDecline = vi.fn()
    state.load.mockResolvedValue(doc(false))
    gate(onDecline)

    fireEvent.click(await screen.findByText("I do not agree — sign out"))
    expect(onDecline).toHaveBeenCalledTimes(1)
  })
})
