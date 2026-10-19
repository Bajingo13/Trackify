import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import DriverPoster, { PosterTruck } from "./DriverPoster"

// read from disk: a ?raw stylesheet import comes back empty under this test setup
const css = readFileSync(path.join(process.cwd(), "src/driver/driver-poster.css"), "utf8")

describe("driver sign-in poster", () => {
  it("keeps the ground out of assistive tech and out of the way of taps", () => {
    const { container } = render(<><DriverPoster /><PosterTruck /></>)
    expect(container.querySelector(".dp")).toHaveAttribute("aria-hidden", "true")
    expect(css).toMatch(/\.dp-stage\s*\{[^}]*pointer-events:\s*none/)
  })

  it("shows the Trackify wordmark, named once for screen readers", () => {
    const { container } = render(<><DriverPoster /><PosterTruck /></>)
    const logos = screen.getAllByRole("img", { name: "Trackify" })
    expect(logos).toHaveLength(1)
    expect(logos[0]).toHaveClass("dp-logo")
    expect(logos[0].getAttribute("src")).toBeTruthy()
    expect(container.querySelector(".dp-stage")).not.toHaveAttribute("aria-hidden")
  })

  it("is a still poster: nothing in it animates", () => {
    expect(css.length).toBeGreaterThan(500) // the real stylesheet, not an empty stand-in
    const { container } = render(<><DriverPoster /><PosterTruck /></>)
    expect(container.querySelectorAll("animate, animateTransform, animateMotion")).toHaveLength(0)
    expect(css).not.toMatch(/animation|@keyframes|transition/)
  })

  it("takes its accent from the system blue, not a colour outside the palette", () => {
    expect(css).toMatch(/#78a2ff/i)
    // the orange the first draft used
    expect(css).not.toMatch(/#ff7a1a|#ff8a2a/i)
  })
})
