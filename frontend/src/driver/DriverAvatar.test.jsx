import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ blob: vi.fn() }))
vi.mock("./driverApi", () => ({ driverBlobUrl: (...args) => state.blob(...args) }))

import DriverAvatar from "./DriverAvatar"

describe("the picture beside the name on Home", () => {
  beforeEach(() => {
    state.blob.mockReset()
    URL.revokeObjectURL = vi.fn()
  })

  it("shows initials until the driver has uploaded a photo, and asks for nothing", () => {
    const { container } = render(<DriverAvatar name="Juan Dela Cruz" hasPhoto={false} />)
    expect(container.querySelector(".dr-avatar")).toHaveTextContent("JD")
    expect(container.querySelector("img")).toBeNull()
    expect(state.blob).not.toHaveBeenCalled()
  })

  it("shows the uploaded photo once it has loaded", async () => {
    state.blob.mockResolvedValue("blob:photo-1")
    const { container } = render(<DriverAvatar name="Juan Dela Cruz" hasPhoto photoUpdatedAt="t1" />)
    await waitFor(() => expect(container.querySelector("img")).toHaveAttribute("src", "blob:photo-1"))
    expect(state.blob).toHaveBeenCalledWith("/me/photo")
  })

  it("fetches again when a new photo is saved, so the replacement shows rather than the old one", async () => {
    state.blob.mockResolvedValueOnce("blob:old").mockResolvedValueOnce("blob:new")
    const { container, rerender } = render(<DriverAvatar name="Juan Dela Cruz" hasPhoto photoUpdatedAt="t1" />)
    await waitFor(() => expect(container.querySelector("img")).toHaveAttribute("src", "blob:old"))

    rerender(<DriverAvatar name="Juan Dela Cruz" hasPhoto photoUpdatedAt="t2" />)
    await waitFor(() => expect(container.querySelector("img")).toHaveAttribute("src", "blob:new"))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:old")
  })

  it("falls back to initials when the photo is removed", async () => {
    state.blob.mockResolvedValue("blob:photo-1")
    const { container, rerender } = render(<DriverAvatar name="Juan Dela Cruz" hasPhoto photoUpdatedAt="t1" />)
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull())

    rerender(<DriverAvatar name="Juan Dela Cruz" hasPhoto={false} photoUpdatedAt="t2" />)
    await waitFor(() => expect(container.querySelector("img")).toBeNull())
    expect(screen.getByText("JD")).toBeInTheDocument()
  })

  it("keeps the initials when the photo cannot be fetched", async () => {
    state.blob.mockRejectedValue(new Error("offline"))
    const { container } = render(<DriverAvatar name="Juan Dela Cruz" hasPhoto photoUpdatedAt="t1" />)
    await waitFor(() => expect(state.blob).toHaveBeenCalled())
    expect(container.querySelector(".dr-avatar")).toHaveTextContent("JD")
  })
})
