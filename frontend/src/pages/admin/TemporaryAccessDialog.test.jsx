import { describe, test, expect, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const { default: TemporaryAccessDialog } = await import("./TemporaryAccessDialog")

const inThreeDays = new Date(Date.now() + 72 * 3_600_000).toISOString()

describe("temporary access handover", () => {
  test("emailed: says where it went and when it lapses, never the password", () => {
    render(
      <TemporaryAccessDialog
        access={{ delivery: "email", email: "new@example.com", name: "Ana Cruz", expiresAt: inThreeDays }}
        onClose={vi.fn()}
        onCopy={vi.fn()}
      />
    )
    expect(screen.getByRole("dialog", { name: /temporary access sent/i })).toBeTruthy()
    expect(screen.getByText("Ana Cruz")).toBeTruthy()
    expect(screen.getByText("new@example.com")).toBeTruthy()
    expect(screen.getByText(/in 3 days/)).toBeTruthy()
    expect(screen.queryByLabelText("Temporary password")).toBeNull()
  })

  test("not emailed: shows the password once, the reason, and copies it", async () => {
    const onCopy = vi.fn().mockResolvedValue()
    render(
      <TemporaryAccessDialog
        access={{
          delivery: "screen", email: "new@example.com", expiresAt: inThreeDays,
          temporaryPassword: "Tmp-4821-xk", deliveryProblem: "Email is not set up on this server.",
        }}
        onClose={vi.fn()}
        onCopy={onCopy}
      />
    )
    expect(screen.getByRole("dialog", { name: /temporary password created/i })).toBeTruthy()
    expect(screen.getByLabelText("Temporary password").textContent).toBe("Tmp-4821-xk")
    expect(screen.getByText(/not set up on this server/i)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }))
    await waitFor(() => expect(screen.getByRole("button", { name: /copied/i })).toBeTruthy())
    expect(onCopy).toHaveBeenCalledOnce()
  })

  test("invitation emailed: confirms who it went to, never shows the link", () => {
    render(
      <TemporaryAccessDialog
        kind="invite"
        access={{ delivery: "email", email: "new@example.com", name: "Ana Cruz", expiresAt: inThreeDays }}
        onClose={vi.fn()}
        onCopy={vi.fn()}
      />
    )
    expect(screen.getByRole("dialog", { name: /invitation sent/i })).toBeTruthy()
    expect(screen.getByText(/choose their own password/i)).toBeTruthy()
    expect(screen.queryByLabelText("Invitation link")).toBeNull()
  })

  test("invitation not emailed: hands over the one-time link to copy", async () => {
    const onCopy = vi.fn().mockResolvedValue()
    render(
      <TemporaryAccessDialog
        kind="invite"
        access={{
          delivery: "link", email: "new@example.com", expiresAt: inThreeDays,
          inviteUrl: "https://trackify.example/accept-invite?token=abc", deliveryProblem: "The invitation email could not be sent.",
        }}
        onClose={vi.fn()}
        onCopy={onCopy}
      />
    )
    expect(screen.getByRole("dialog", { name: /invitation link created/i })).toBeTruthy()
    expect(screen.getByLabelText("Invitation link").textContent).toMatch(/accept-invite\?token=abc/)
    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }))
    await waitFor(() => expect(onCopy).toHaveBeenCalledOnce())
    expect(screen.getByRole("button", { name: /i’ve shared the link/i })).toBeTruthy()
  })

  test("closes on Escape, the close button, and the backdrop, not a click inside", () => {
    const onClose = vi.fn()
    render(
      <TemporaryAccessDialog
        access={{ delivery: "email", email: "new@example.com", expiresAt: inThreeDays }}
        onClose={onClose}
        onCopy={vi.fn()}
      />
    )
    fireEvent.mouseDown(screen.getByRole("dialog"))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: "Escape" })
    fireEvent.click(screen.getByRole("button", { name: /close/i }))
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
