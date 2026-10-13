import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import DriverThemeToggle from "./DriverThemeToggle"

describe("driver theme toggle", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-theme")
    document.documentElement.style.colorScheme = ""
  })

  it("applies and persists an explicit dark theme", () => {
    render(<DriverThemeToggle />)

    fireEvent.click(screen.getByRole("button", { name: "Use dark mode" }))

    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    expect(document.documentElement.style.colorScheme).toBe("dark")
    expect(localStorage.getItem("tk_theme")).toBe("dark")
    expect(screen.getByRole("button", { name: "Use dark mode" })).toHaveAttribute("aria-pressed", "true")
  })

  it("switches back to light mode without losing the preference", () => {
    localStorage.setItem("tk_theme", "dark")
    document.documentElement.setAttribute("data-theme", "dark")
    render(<DriverThemeToggle />)

    fireEvent.click(screen.getByRole("button", { name: "Use light mode" }))

    expect(document.documentElement).toHaveAttribute("data-theme", "light")
    expect(localStorage.getItem("tk_theme")).toBe("light")
  })
})
