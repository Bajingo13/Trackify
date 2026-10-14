import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./native", () => ({ tap: vi.fn() }))

import DriverFaq from "./DriverFaq"
import { FAQ } from "./faqContent"

describe("the FAQ, a page at a time", () => {
  beforeEach(() => localStorage.clear())

  it("shows ten answers, not all of them, and says how many there are", () => {
    render(<DriverFaq onAction={() => {}} />)
    expect(FAQ.length).toBeGreaterThan(10)
    expect(screen.getAllByRole("button", { name: /^[^]+$/ }).filter((b) => b.className.includes("dr-faq-q"))).toHaveLength(10)
    expect(screen.getByText(`Showing 1–10 of ${FAQ.length} answers`)).toBeInTheDocument()
    expect(screen.getByText(/^Page 1 of \d+$/)).toBeInTheDocument()
  })

  it("moves through the rest with Next and Previous, and the first page cannot go back", () => {
    render(<DriverFaq onAction={() => {}} />)
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(screen.getByText(new RegExp(`Showing 11–\\d+ of ${FAQ.length} answers`))).toBeInTheDocument()
    expect(screen.getByText(/^Page 2 of/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }))
    expect(screen.getByText(/^Page 1 of/)).toBeInTheDocument()
  })

  it("lets the driver choose how many to see, and every answer is still there to reach", () => {
    render(<DriverFaq onAction={() => {}} />)
    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), { target: { value: "50" } })
    expect(screen.getByText(`Showing 1–${FAQ.length} of ${FAQ.length} answers`)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull()
    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), { target: { value: "5" } })
    expect(screen.getByText(`Showing 1–5 of ${FAQ.length} answers`)).toBeInTheDocument()
  })

  it("remembers the choice the next time the list is opened", () => {
    const first = render(<DriverFaq onAction={() => {}} />)
    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), { target: { value: "20" } })
    first.unmount()
    render(<DriverFaq onAction={() => {}} />)
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toHaveValue("20")
  })

  it("starts again at page 1 when the driver searches or picks a topic", () => {
    render(<DriverFaq onAction={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(screen.getByText(/^Page 2 of/)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: "truck" } })
    expect(screen.queryByText(/^Page 2 of/)).toBeNull()
  })

  it("shows no page controls when everything fits on the smallest page", () => {
    render(<DriverFaq onAction={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: "flat tyre" } })
    expect(screen.queryByRole("navigation", { name: "answers pages" })).toBeNull()
    expect(within(document.body).getByText("I have a flat tyre.")).toBeInTheDocument()
  })
})
