import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import ProfileThemeSwitch from "./ProfileThemeSwitch"

describe("profile theme switch", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-theme")
    document.documentElement.style.colorScheme = ""
  })

  it("uses one switch to apply and persist dark mode", () => {
    render(<ProfileThemeSwitch />)

    const control = screen.getByRole("switch", { name: "Dark mode" })
    expect(control).toHaveAttribute("aria-checked", "false")
    expect(screen.getAllByRole("switch")).toHaveLength(1)
    expect(document.querySelectorAll("button")).toHaveLength(1)

    fireEvent.click(control)

    expect(control).toHaveAttribute("aria-checked", "true")
    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    expect(document.documentElement.style.colorScheme).toBe("dark")
    expect(localStorage.getItem("tk_theme")).toBe("dark")
  })

  it("starts from the saved choice and switches back to light mode", () => {
    localStorage.setItem("tk_theme", "dark")
    document.documentElement.setAttribute("data-theme", "dark")
    render(<ProfileThemeSwitch />)

    const control = screen.getByRole("switch", { name: "Dark mode" })
    expect(control).toHaveAttribute("aria-checked", "true")

    fireEvent.click(control)

    expect(control).toHaveAttribute("aria-checked", "false")
    expect(document.documentElement).toHaveAttribute("data-theme", "light")
    expect(localStorage.getItem("tk_theme")).toBe("light")
  })
})
