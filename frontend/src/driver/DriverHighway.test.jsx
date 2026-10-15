import { render } from "@testing-library/react"
import { act } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import DriverHighway from "./DriverHighway"

describe("driver highway scene", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-theme")
  })

  it("is decoration only: hidden from assistive tech and out of the way of taps", () => {
    const { container } = render(<DriverHighway />)
    const scene = container.querySelector(".hw")
    expect(scene).toHaveAttribute("aria-hidden", "true")
  })

  it("draws the truck and its traffic", () => {
    const { container } = render(<DriverHighway />)
    expect(container.querySelectorAll(".hw-hero")).toHaveLength(1)
    // oncoming traffic runs the other way, so it must be told to
    expect(container.querySelectorAll(".hw-veh[data-rev]").length).toBeGreaterThan(0)
    expect(container.querySelectorAll(".hw-veh:not(.hw-hero)").length).toBeGreaterThan(5)
  })

  it("starts in daylight and switches to night with the app theme", async () => {
    localStorage.setItem("tk_theme", "light")
    document.documentElement.setAttribute("data-theme", "light")
    const { container } = render(<DriverHighway />)
    const scene = container.querySelector(".hw")
    expect(scene).toHaveAttribute("data-night", "false")

    // the theme toggle stamps the root element; the scene follows it live
    await act(async () => {
      localStorage.setItem("tk_theme", "dark")
      document.documentElement.setAttribute("data-theme", "dark")
      await Promise.resolve()
    })
    expect(scene).toHaveAttribute("data-night", "true")
  })
})
