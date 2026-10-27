import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ inspect: vi.fn() }))

vi.mock("./driverApi", () => ({
  currentDriverId: () => 7,
  driverInspect: (...a) => state.inspect(...a),
}))
vi.mock("./native", () => ({ tap: vi.fn(), notifySuccess: vi.fn() }))
vi.mock("./readPosition", () => ({ readPosition: () => Promise.resolve({ lat: 7.07, lng: 125.61 }) }))
// the real picker opens the camera; here a photo is added by a button
vi.mock("./PhotoPick", () => ({
  default: ({ onFile, takeLabel }) => (
    <button type="button" onClick={() => onFile(new File(["x"], "defect.jpg", { type: "image/jpeg" }))}>{takeLabel}</button>
  ),
}))

const { default: DriverInspection } = await import("./DriverInspection")
const { localInspection } = await import("./inspectionLocal")

const CHECKLIST = [
  { key: "brakes", label: "Brakes", hint: "Pedal firm", critical: true },
  { key: "tyres", label: "Tyres", hint: "Tread", critical: true },
  { key: "lights", label: "Lights", hint: "All work", critical: true },
  { key: "fluids", label: "Fluids and leaks", hint: "Nothing dripping", critical: false },
]

function renderForm() {
  const onDone = vi.fn()
  render(<DriverInspection tripId={41} ticketNo="TT-0041" plateNo="ABC 1234" checklist={CHECKLIST} onBack={() => {}} onDone={onDone} />)
  return { onDone }
}
const confirmBox = () => screen.getByLabelText(/I inspected this vehicle and it is in good condition/)
const confirmButton = () => screen.getByRole("button", { name: "Confirm and continue" })
const openReport = () => fireEvent.click(screen.getByRole("button", { name: /Report a problem/ }))

describe("the pre-trip inspection: nothing wrong", () => {
  beforeEach(() => {
    localStorage.clear()
    state.inspect.mockReset().mockResolvedValue({ success: true, data: { result: "pass" } })
  })

  it("reminds the driver what to check, with no checklist to tick through", () => {
    renderForm()
    const note = screen.getByRole("note")
    for (const label of ["Brakes", "Tyres", "Lights", "Fluids and leaks"]) expect(note).toHaveTextContent(label)
    expect(note).toHaveTextContent(/Do not drive a vehicle that is not safe/)
    // one confirmation, not one per item
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
    expect(screen.queryByRole("radiogroup")).toBeNull()
  })

  it("will not continue until the driver confirms", () => {
    renderForm()
    expect(confirmButton()).toBeDisabled()
    fireEvent.click(confirmBox())
    expect(confirmButton()).toBeEnabled()
    expect(state.inspect).not.toHaveBeenCalled()
  })

  it("one confirmation files every item as OK, and the trip can start", async () => {
    const { onDone } = renderForm()
    fireEvent.click(confirmBox())
    fireEvent.click(confirmButton())
    await waitFor(() => expect(state.inspect).toHaveBeenCalledTimes(1))
    const [tripId, body] = state.inspect.mock.calls[0]
    expect(tripId).toBe(41)
    expect(body.answers).toEqual(CHECKLIST.map((c) => ({ key: c.key, response: "ok" })))
    expect(body.photos).toEqual([])
    expect(body.clientRef).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(await screen.findByText("Inspection confirmed")).toBeInTheDocument()
    expect(localInspection(7, 41)).toMatchObject({ result: "pass" })
    fireEvent.click(screen.getByRole("button", { name: "Back to the trip" }))
    expect(onDone).toHaveBeenCalledWith("pass")
  })

  it("keeps the same reference when sent again after a failure", async () => {
    state.inspect.mockRejectedValueOnce(new Error("Trackify took too long to answer.")).mockResolvedValueOnce({ data: { result: "pass" } })
    renderForm()
    fireEvent.click(confirmBox())
    fireEvent.click(confirmButton())
    expect(await screen.findByText("Trackify took too long to answer.")).toBeInTheDocument()
    fireEvent.click(confirmButton())
    await screen.findByText("Inspection confirmed")
    const [first, second] = state.inspect.mock.calls.map(([, b]) => b.clientRef)
    expect(second).toBe(first)
  })
})

describe("the pre-trip inspection: reporting a problem", () => {
  beforeEach(() => {
    localStorage.clear()
    state.inspect.mockReset().mockResolvedValue({ success: true, data: { result: "fail_critical" } })
  })

  it("needs what is wrong, a description and a photo", async () => {
    renderForm()
    openReport()
    fireEvent.click(screen.getByRole("button", { name: "Send to Fleet" }))
    expect(await screen.findByText("Choose what is wrong.")).toBeInTheDocument()
    expect(screen.getByText("Say what is wrong.")).toBeInTheDocument()
    expect(screen.getByText("Add a photo of the problem.")).toBeInTheDocument()
    expect(state.inspect).not.toHaveBeenCalled()

    // each message goes once its part is done
    fireEvent.click(screen.getByRole("button", { name: "Tyres" }))
    expect(screen.queryByText("Choose what is wrong.")).toBeNull()
    fireEvent.change(screen.getByLabelText(/Describe the problem/), { target: { value: "Flat" } })
    expect(screen.queryByText("Say what is wrong.")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }))
    expect(screen.queryByText("Add a photo of the problem.")).toBeNull()
  })

  it("a brake problem is sent to Fleet, says not to drive, and holds the trip on this phone", async () => {
    renderForm()
    openReport()
    fireEvent.click(screen.getByRole("button", { name: "Brakes" }))
    expect(screen.getByText(/the trip waits until the Fleet team approves departure/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Describe the problem/), { target: { value: "Pedal goes to the floor" } })
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }))
    fireEvent.click(screen.getByRole("button", { name: "Send to Fleet" }))

    await waitFor(() => expect(state.inspect).toHaveBeenCalledTimes(1))
    const body = state.inspect.mock.calls[0][1]
    expect(body.answers).toEqual([
      { key: "brakes", response: "problem", note: "Pedal goes to the floor" },
      { key: "tyres", response: "ok" }, { key: "lights", response: "ok" }, { key: "fluids", response: "ok" },
    ])
    // one set of photos for the report
    expect(body.photos.map((p) => p.key)).toEqual([""])
    expect(await screen.findByText("Do not drive this vehicle")).toBeInTheDocument()
    expect(localInspection(7, 41)).toMatchObject({ result: "fail_critical" })
  })

  it("can report more than one area at once, with one description", async () => {
    state.inspect.mockResolvedValue({ success: true, data: { result: "fail_critical" } })
    renderForm()
    openReport()
    fireEvent.click(screen.getByRole("button", { name: "Tyres" }))
    fireEvent.click(screen.getByRole("button", { name: "Fluids and leaks" }))
    fireEvent.change(screen.getByLabelText(/Describe the problem/), { target: { value: "Flat tyre and an oil drip" } })
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }))
    fireEvent.click(screen.getByRole("button", { name: "Send to Fleet" }))
    await waitFor(() => expect(state.inspect).toHaveBeenCalled())
    const problems = state.inspect.mock.calls[0][1].answers.filter((a) => a.response === "problem").map((a) => a.key)
    expect(problems).toEqual(["tyres", "fluids"])
  })

  it("a non-critical problem is passed to Fleet and the trip may start, even out of signal", async () => {
    state.inspect.mockResolvedValue({ queued: true })
    renderForm()
    openReport()
    fireEvent.click(screen.getByRole("button", { name: "Fluids and leaks" }))
    expect(screen.queryByText(/the trip waits/)).toBeNull()
    fireEvent.change(screen.getByLabelText(/Describe the problem/), { target: { value: "Coolant low" } })
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }))
    fireEvent.click(screen.getByRole("button", { name: "Send to Fleet" }))
    expect(await screen.findByText("Problem reported")).toBeInTheDocument()
    expect(screen.getByText(/You can start the trip/)).toBeInTheDocument()
    expect(screen.getByText(/Saved on this phone/)).toBeInTheDocument()
    expect(localInspection(7, 41)).toMatchObject({ result: "fail_noncritical" })
  })

  it("goes back to the confirmation without sending anything", () => {
    renderForm()
    openReport()
    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(confirmButton()).toBeInTheDocument()
    expect(state.inspect).not.toHaveBeenCalled()
  })
})
