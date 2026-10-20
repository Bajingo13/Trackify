import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"

const api = vi.hoisted(() => ({
  driverDeviceStatus: vi.fn(),
  driverVerifyDevice: vi.fn(),
  driverResendCode: vi.fn(),
  driverAskOffice: vi.fn(),
}))
vi.mock("./driverApi", () => api)

const { VerifyPhone } = await import("./DriverDeviceScreens")

const pending = (extra = {}) => ({
  pendingToken: "p", driver: { name: "Juan" }, emailHint: "ju•••@gmail.com",
  emailSent: true, codeMinutes: 10, firstPhone: false, ...extra,
})

const fail = (message, extra = {}) => Object.assign(new Error(message), extra)

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.driverDeviceStatus.mockResolvedValue({ status: "waiting" })
})

describe("verifying a phone with the emailed code", () => {
  it("says where the code went, and signs in as soon as six digits are typed", async () => {
    api.driverVerifyDevice.mockResolvedValue({ token: "t" })
    const onSignedIn = vi.fn()
    render(<VerifyPhone pending={pending()} onSignedIn={onSignedIn} onCancel={() => {}} />)
    expect(screen.getByText(/ju•••@gmail\.com/)).toBeInTheDocument()
    expect(screen.queryByText(/recovery code/i)).toBeNull()
    fireEvent.change(screen.getByLabelText("Code from your email"), { target: { value: "482 913" } })
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith({ token: "t", driver: { name: "Juan" } }))
    expect(api.driverVerifyDevice).toHaveBeenCalledWith("p", "482913")
  })

  it("is worded as a welcome on a new account's first phone", () => {
    render(<VerifyPhone pending={pending({ firstPhone: true })} onSignedIn={() => {}} onCancel={() => {}} />)
    expect(screen.getByText("Check your email")).toBeInTheDocument()
    expect(screen.getByText(/finish signing in/)).toBeInTheDocument()
  })

  it("a wrong code is cleared, and the last few tries are counted", async () => {
    api.driverVerifyDevice.mockRejectedValue(fail("That code isn't right.", { status: 401, attemptsLeft: 2 }))
    render(<VerifyPhone pending={pending()} onSignedIn={() => {}} onCancel={() => {}} />)
    const input = screen.getByLabelText("Code from your email")
    fireEvent.change(input, { target: { value: "000000" } })
    expect(await screen.findByRole("alert")).toHaveTextContent("That code isn't right. 2 tries left.")
    expect(input).toHaveValue("")
  })

  it("can send a new code once the wait is over", async () => {
    vi.useFakeTimers()
    try {
      api.driverResendCode.mockResolvedValue({ emailSent: true })
      render(<VerifyPhone pending={pending()} onSignedIn={() => {}} onCancel={() => {}} />)
      const button = screen.getByRole("button", { name: /Send a new code in 60s/ })
      expect(button).toBeDisabled()
      for (let i = 0; i < 60; i += 1) act(() => { vi.advanceTimersByTime(1000) })
      const ready = screen.getByRole("button", { name: "Send a new code" })
      expect(ready).not.toBeDisabled()
      await act(async () => { fireEvent.click(ready) })
      expect(api.driverResendCode).toHaveBeenCalledWith("p")
      expect(screen.getByRole("status")).toHaveTextContent(/new code/)
    } finally {
      vi.useRealTimers()
    }
  })

  it("a driver who can't get the email asks the office, and waits", async () => {
    api.driverAskOffice.mockResolvedValue({})
    render(<VerifyPhone pending={pending()} onSignedIn={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "Ask my office" }))
    expect(await screen.findByText(/Waiting for your office to approve this phone/)).toBeInTheDocument()
    expect(api.driverAskOffice).toHaveBeenCalledWith("p")
  })

  it("with no email on file, only the office can help, and it has already been asked", () => {
    render(<VerifyPhone pending={pending({ emailHint: null, emailSent: false })} onSignedIn={() => {}} onCancel={() => {}} />)
    expect(screen.getByText(/no email on file/)).toBeInTheDocument()
    expect(screen.queryByLabelText("Code from your email")).toBeNull()
    expect(screen.getByText(/Waiting for your office/)).toBeInTheDocument()
  })

  it("says plainly when the email could not be sent", () => {
    render(<VerifyPhone pending={pending({ emailSent: false, emailError: "We couldn't send the email. Try again, or call your office." })} onSignedIn={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't send the email")
    expect(screen.getByRole("button", { name: "Send a new code" })).not.toBeDisabled()
  })

  it("too many wrong codes leave only the office", async () => {
    api.driverVerifyDevice.mockRejectedValue(fail("Too many wrong codes.", { status: 423 }))
    render(<VerifyPhone pending={pending()} onSignedIn={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText("Code from your email"), { target: { value: "111111" } })
    expect(await screen.findByText(/Too many wrong codes\. Call your office/)).toBeInTheDocument()
    expect(screen.queryByLabelText("Code from your email")).toBeNull()
  })
})
