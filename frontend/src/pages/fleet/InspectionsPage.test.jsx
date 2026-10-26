import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  perms: new Set(["inspection.read", "inspection.review"]),
  list: vi.fn(),
  get: vi.fn(),
  photo: vi.fn(),
  approve: vi.fn(),
  review: vi.fn(),
  toast: vi.fn(),
}))

vi.mock("../../components/layout/AppShell", () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock("../../auth/permissions", () => ({ usePermissions: () => ({ can: (p) => state.perms.has(p) }) }))
vi.mock("../../components/shared/Toast", () => ({ useToast: () => ({ addToast: state.toast }) }))
vi.mock("../../services/fleet/inspectionService", async (importOriginal) => ({
  ...(await importOriginal()),
  listInspections: (...a) => state.list(...a),
  getInspection: (...a) => state.get(...a),
  getInspectionPhoto: (...a) => state.photo(...a),
  approveDeparture: (...a) => state.approve(...a),
  reviewInspection: (...a) => state.review(...a),
}))

const { default: InspectionsPage } = await import("./InspectionsPage")

const ITEMS = [
  { key: "brakes", label: "Brakes", critical: true, response: "problem", note: "Pedal goes to the floor" },
  { key: "tyres", label: "Tyres", critical: true, response: "ok", note: null },
  { key: "lights", label: "Lights", critical: true, response: "ok", note: null },
  { key: "fluids", label: "Fluids and leaks", critical: false, response: "na", note: null },
]
const row = (extra = {}) => ({
  id: 5, tripId: 41, ticketNo: "TT-2026-000041", plateNo: "ABC 1234", driverName: "Juan Dela Cruz",
  result: "fail_critical", reviewStatus: "pending", approvedAt: null, approvalReason: null,
  submittedAt: "2026-10-26T06:00:00", capturedAt: "2026-10-26T05:58:00", ...extra,
})
const detail = (extra = {}) => ({ ...row(extra), items: ITEMS, photos: [{ id: 9, itemKey: "brakes" }], ...extra })

const renderPage = (path = "/fleet/inspections") =>
  render(<MemoryRouter initialEntries={[path]}><InspectionsPage /></MemoryRouter>)

describe("Fleet → Inspections", () => {
  beforeEach(() => {
    state.perms = new Set(["inspection.read", "inspection.review"])
    for (const k of ["list", "get", "photo", "approve", "review", "toast"]) state[k].mockReset()
    state.list.mockResolvedValue([row()])
    state.get.mockResolvedValue(detail())
    state.photo.mockResolvedValue("data:image/png;base64,AAAA")
    state.approve.mockResolvedValue({ success: true })
    state.review.mockResolvedValue({ success: true })
  })

  it("opens on what is waiting for Fleet, a held trip marked as such", async () => {
    renderPage()
    expect(await screen.findByText("ABC 1234 · TT-2026-000041")).toBeInTheDocument()
    expect(screen.getByText("Trip on hold")).toBeInTheDocument()
    expect(state.list).toHaveBeenCalledWith("pending")

    fireEvent.click(screen.getByRole("button", { name: "All" }))
    await waitFor(() => expect(state.list).toHaveBeenLastCalledWith("all"))
  })

  it("shows the driver's answers and the photo of the defect", async () => {
    renderPage()
    fireEvent.click(await screen.findByText("ABC 1234 · TT-2026-000041"))
    const checklist = await screen.findByRole("region", { name: "Checklist" })
    expect(within(checklist).getByText("Pedal goes to the floor")).toBeInTheDocument()
    expect(within(checklist).getAllByText("Critical")).toHaveLength(3)
    expect(await within(checklist).findByAltText("Defect photo 9")).toHaveAttribute("src", "data:image/png;base64,AAAA")
    expect(state.photo).toHaveBeenCalledWith(5, 9)
  })

  it("approves departure only with a reason, and then the trip can go", async () => {
    renderPage("/fleet/inspections?open=5")
    const approve = await screen.findByRole("button", { name: "Approve departure" })
    expect(approve).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Why can this vehicle go/), { target: { value: "ok" } })
    expect(approve).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Why can this vehicle go/), { target: { value: "Brake line replaced and road-tested" } })
    state.get.mockResolvedValue(detail({ approvedAt: "2026-10-26T07:00:00", approvalReason: "Brake line replaced and road-tested", reviewStatus: "reviewed" }))
    fireEvent.click(approve)

    await waitFor(() => expect(state.approve).toHaveBeenCalledWith(5, "Brake line replaced and road-tested"))
    expect(state.toast).toHaveBeenCalledWith("Departure approved. The driver can start the trip.", "success")
    expect(await screen.findAllByText("Departure approved")).not.toHaveLength(0)
    expect(screen.queryByRole("button", { name: "Approve departure" })).toBeNull()
    // the list is refreshed too
    expect(state.list.mock.calls.length).toBeGreaterThan(1)
  })

  it("a non-critical issue is marked reviewed, not approved", async () => {
    state.get.mockResolvedValue(detail({ result: "fail_noncritical", items: ITEMS.map((i) => (i.key === "fluids" ? { ...i, response: "problem", note: "Coolant low" } : { ...i, response: "ok", note: null })) }))
    renderPage("/fleet/inspections?open=5")
    fireEvent.click(await screen.findByRole("button", { name: "Mark reviewed" }))
    await waitFor(() => expect(state.review).toHaveBeenCalledWith(5, ""))
    expect(screen.queryByRole("button", { name: "Approve departure" })).toBeNull()
  })

  it("without the right to review, the inspection is shown but cannot be settled", async () => {
    state.perms = new Set(["inspection.read"])
    renderPage("/fleet/inspections?open=5")
    await screen.findByRole("region", { name: "Checklist" })
    expect(screen.queryByRole("button", { name: "Approve departure" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Mark reviewed" })).toBeNull()
  })

  it("says so plainly when nothing is waiting", async () => {
    state.list.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText("Nothing waiting")).toBeInTheDocument()
  })

  it("shows the server's refusal instead of pretending it worked", async () => {
    state.approve.mockRejectedValue(new Error("Departure was already approved for this inspection."))
    renderPage("/fleet/inspections?open=5")
    fireEvent.change(await screen.findByLabelText(/Why can this vehicle go/), { target: { value: "Repaired and tested" } })
    fireEvent.click(screen.getByRole("button", { name: "Approve departure" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Departure was already approved")
  })
})
