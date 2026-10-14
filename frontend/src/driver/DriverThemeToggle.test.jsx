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

    const control = screen.getByRole("switch", { name: "Dark mode" })
    expect(control).toHaveAttribute("aria-checked", "false")
    expect(screen.getAllByRole("switch")).toHaveLength(1)
    expect(document.querySelectorAll("button")).toHaveLength(1)

    fireEvent.click(control)

    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    expect(document.documentElement.style.colorScheme).toBe("dark")
    expect(localStorage.getItem("tk_theme")).toBe("dark")
    expect(control).toHaveAttribute("aria-checked", "true")
  })

  it("switches back to light mode without losing the preference", () => {
    localStorage.setItem("tk_theme", "dark")
    document.documentElement.setAttribute("data-theme", "dark")
    render(<DriverThemeToggle />)

    const control = screen.getByRole("switch", { name: "Dark mode" })
    expect(control).toHaveAttribute("aria-checked", "true")

    fireEvent.click(control)

    expect(document.documentElement).toHaveAttribute("data-theme", "light")
    expect(localStorage.getItem("tk_theme")).toBe("light")
    expect(control).toHaveAttribute("aria-checked", "false")
  })
})
