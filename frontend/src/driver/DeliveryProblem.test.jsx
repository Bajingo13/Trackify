import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ report: vi.fn() }))

vi.mock("./driverApi", () => ({
  currentDriverId: () => 7,
  driverDeliveryReport: (...a) => state.report(...a),
}))
vi.mock("./native", () => ({ tap: vi.fn(), notifySuccess: vi.fn() }))
vi.mock("./readPosition", () => ({ readPosition: () => Promise.resolve({ lat: 7.07, lng: 125.61 }) }))
// the real picker opens the camera; here a photo is added by a button
vi.mock("./PhotoPick", () => ({
  default: ({ onFile, takeLabel }) => (
    <button type="button" onClick={() => onFile(new File(["x"], "gate.jpg", { type: "image/jpeg" }))}>{takeLabel}</button>
  ),
}))

const { default: DeliveryProblem } = await import("./DeliveryProblem")
const { localNotDelivered } = await import("./deliveryReport")

function renderForm(outcome) {
  const onDone = vi.fn()
  const onBack = vi.fn()
  render(<DeliveryProblem tripId={41} ticketNo="TT-0041" outcome={outcome} onBack={onBack} onDone={onDone} />)
  return { onDone, onBack }
}
const send = () => fireEvent.click(screen.getByRole("button", { name: "Send to the office" }))
const choose = (label) => fireEvent.click(screen.getByRole("radio", { name: new RegExp(label) }))
const describeIt = (text) => fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: text } })

describe("not delivered", () => {
  beforeEach(() => {
    localStorage.clear()
    state.report.mockReset().mockResolvedValue({ success: true, data: { id: 3 } })
  })

  it("says no delivery will be recorded, and offers only the not-delivered reasons", () => {
    renderForm("not_delivered")
    expect(screen.getByRole("note")).toHaveTextContent(/No delivery will be recorded/)
    const reasons = screen.getAllByRole("radio").map((r) => r.querySelector(".dr-pause-reason-title").textContent)
    expect(reasons).toEqual(["Refused by the receiver", "Receiver absent or closed", "Wrong address", "Other reason"])
  })

  it("needs a reason and the driver's words, but no photo", async () => {
    renderForm("not_delivered")
    send()
    expect(await screen.findByText("Choose why it was not delivered.")).toBeInTheDocument()
    expect(screen.getByText("Say what happened, in a few words.")).toBeInTheDocument()
    expect(state.report).not.toHaveBeenCalled()
    choose("Receiver absent")
    describeIt("Gate locked, nobody answering the phone")
    expect(screen.queryByText("Choose why it was not delivered.")).toBeNull()
    expect(screen.queryByText("Say what happened, in a few words.")).toBeNull()
    send()
    await waitFor(() => expect(state.report).toHaveBeenCalledTimes(1))
    const [tripId, body] = state.report.mock.calls[0]
    expect(tripId).toBe(41)
    expect(body).toMatchObject({
      outcome: "not_delivered", reason: "absent", note: "Gate locked, nobody answering the phone",
      qtyExpected: null, qtyDelivered: null, photos: [], lat: 7.07, lng: 125.61,
    })
    expect(body.clientRef).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
  })

  it("says to keep the load, and remembers the report on this phone even out of signal", async () => {
    state.report.mockResolvedValue({ queued: true })
    const { onDone } = renderForm("not_delivered")
    choose("Refused")
    describeIt("Customer cancelled the order")
    send()
    expect(await screen.findByText("Reported: not delivered")).toBeInTheDocument()
    expect(screen.getByText(/Keep the load on the truck/)).toBeInTheDocument()
    expect(screen.getByText(/Saved on this phone/)).toBeInTheDocument()
    expect(localNotDelivered(7, 41)).toMatchObject({ reason: "refused" })
    fireEvent.click(screen.getByRole("button", { name: "Back to the trip" }))
    expect(onDone).toHaveBeenCalledWith({ queued: true })
  })

  it("keeps the same reference when sent again after a failure", async () => {
    state.report.mockRejectedValueOnce(new Error("Trackify took too long to answer.")).mockResolvedValueOnce({ data: { id: 3 } })
    renderForm("not_delivered")
    choose("Wrong address")
    describeIt("No such street number")
    send()
    expect(await screen.findByText("Trackify took too long to answer.")).toBeInTheDocument()
    send()
    await screen.findByText("Reported: not delivered")
    const [first, second] = state.report.mock.calls.map(([, b]) => b.clientRef)
    expect(second).toBe(first)
  })

  it("goes back without sending anything", () => {
    const { onBack } = renderForm("not_delivered")
    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(onBack).toHaveBeenCalled()
    expect(state.report).not.toHaveBeenCalled()
  })
})

describe("delivered with a problem", () => {
  beforeEach(() => {
    localStorage.clear()
    state.report.mockReset().mockResolvedValue({ success: true, data: { id: 4 } })
  })

  it("offers only the delivered-with-a-problem reasons, and says nothing about keeping the load", () => {
    renderForm("delivered_with_issue")
    expect(screen.queryByRole("note")).toBeNull()
    const reasons = screen.getAllByRole("radio").map((r) => r.querySelector(".dr-pause-reason-title").textContent)
    expect(reasons).toEqual(["Short delivery", "Damaged goods", "Wrong item"])
  })

  it("a short delivery needs both counts, fewer delivered, and a photo", async () => {
    renderForm("delivered_with_issue")
    choose("Short delivery")
    describeIt("Two crates missing, noted on the waybill")
    send()
    expect(await screen.findByText("Enter how many were expected.")).toBeInTheDocument()
    expect(screen.getByText("Short delivery: add a photo.")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Expected/), { target: { value: "10" } })
    fireEvent.change(screen.getByLabelText(/^Delivered/), { target: { value: "10" } })
    send()
    expect(await screen.findByText("A short delivery has fewer delivered than expected.")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Delivered/), { target: { value: "8" } })
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }))
    expect(screen.queryByText("Short delivery: add a photo.")).toBeNull()
    send()
    await waitFor(() => expect(state.report).toHaveBeenCalledTimes(1))
    const body = state.report.mock.calls[0][1]
    expect(body).toMatchObject({ outcome: "delivered_with_issue", reason: "short", qtyExpected: "10", qtyDelivered: "8" })
    expect(body.photos).toHaveLength(1)
    expect(await screen.findByText("Problem reported")).toBeInTheDocument()
    // a problem with a delivery that went through is not a "not delivered"
    expect(localNotDelivered(7, 41)).toBeNull()
  })

  it("damaged goods need a photo; the wrong item does not", async () => {
    renderForm("delivered_with_issue")
    choose("Damaged goods")
    describeIt("Two boxes crushed")
    send()
    expect(await screen.findByText("Damaged goods: add a photo.")).toBeInTheDocument()
    choose("Wrong item")
    expect(screen.queryByText("Damaged goods: add a photo.")).toBeNull()
    send()
    await waitFor(() => expect(state.report).toHaveBeenCalledTimes(1))
    expect(state.report.mock.calls[0][1]).toMatchObject({ reason: "wrong_item", photos: [] })
  })
})
