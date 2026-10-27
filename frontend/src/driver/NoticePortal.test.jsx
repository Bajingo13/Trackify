import React from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import NoticePortal from "./NoticePortal"

describe("NoticePortal", () => {
  it("moves a notice into the fixed notification layer", () => {
    const host = document.createElement("div")
    host.className = "dr-netlayer"
    document.body.appendChild(host)

    render(<NoticePortal><div data-testid="notice">Notice</div></NoticePortal>)

    expect(host).toContainElement(screen.getByTestId("notice"))
    host.remove()
  })

  it("keeps isolated screens usable when the app shell is absent", () => {
    render(<NoticePortal><div>Inline fallback</div></NoticePortal>)
    expect(screen.getByText("Inline fallback")).toBeInTheDocument()
  })
})
