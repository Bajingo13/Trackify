import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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

function renderForm(props = {}) {
  const onDone = vi.fn()
  render(<DriverInspection tripId={41} ticketNo="TT-0041" plateNo="ABC 1234" checklist={CHECKLIST} onBack={() => {}} onDone={onDone} {...props} />)
  return { onDone }
}
const group = (label) => screen.getByRole("radiogroup", { name: label })
const choose = (label, option) => fireEvent.click(within(group(label)).getByRole("radio", { name: option }))
const allOk = () => CHECKLIST.forEach((c) => choose(c.label, "OK"))
const confirm = () => fireEvent.click(screen.getByLabelText(/I checked this vehicle myself/))
const send = () => fireEvent.click(screen.getByRole("button", { name: "Send inspection" }))

describe("the pre-trip inspection", () => {
  beforeEach(() => {
    localStorage.clear()
    state.inspect.mockReset().mockResolvedValue({ success: true, data: { result: "pass" } })
  })

  it("asks about every item, and never offers N/A for brakes, tyres or lights", () => {
    renderForm()
    for (const label of ["Brakes", "Tyres", "Lights"]) {
      expect(within(group(label)).queryByRole("radio", { name: "N/A" })).toBeNull()
    }
    expect(within(group("Fluids and leaks")).getByRole("radio", { name: "N/A" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /all ok/i })).toBeNull()
  })

  it("sends nothing until every item is checked and the driver confirms", async () => {
    renderForm()
    send()
    expect(await screen.findAllByText("Check this item.")).toHaveLength(4)
    allOk()
    send()
    expect(await screen.findByText(/Confirm that you checked/)).toBeInTheDocument()
    expect(state.inspect).not.toHaveBeenCalled()
  })

  it("needs a description and a photo for a problem", async () => {
    renderForm()
    allOk()
    choose("Brakes", "Problem")
    confirm()
    send()
    expect(await screen.findByText("Say what is wrong.")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/What is wrong/), { target: { value: "Pedal goes to the floor" } })
    send()
    expect(await screen.findByText("Add a photo of the problem.")).toBeInTheDocument()
    expect(state.inspect).not.toHaveBeenCalled()
  })

  it("a pass is sent with every answer, and the trip can start", async () => {
    const { onDone } = renderForm()
    allOk()
    choose("Fluids and leaks", "N/A")
    confirm()
    send()
    await waitFor(() => expect(state.inspect).toHaveBeenCalledTimes(1))
    const [tripId, body] = state.inspect.mock.calls[0]
    expect(tripId).toBe(41)
    expect(body.answers).toEqual([
      { key: "brakes", response: "ok" }, { key: "tyres", response: "ok" }, { key: "lights", response: "ok" }, { key: "fluids", response: "na" },
    ])
    expect(body.photos).toEqual([])
    expect(body.clientRef).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(body.lat).toBe(7.07)

    expect(await screen.findByText("Inspection passed")).toBeInTheDocument()
    expect(localInspection(7, 41)).toMatchObject({ result: "pass" })
    fireEvent.click(screen.getByRole("button", { name: "Back to the trip" }))
    expect(onDone).toHaveBeenCalledWith("pass")
  })

  it("a failed brake check says not to drive, and holds the trip on this phone", async () => {
    state.inspect.mockResolvedValue({ success: true, data: { result: "fail_critical" } })
    renderForm()
    allOk()
    choose("Brakes", "Problem")
    fireEvent.change(screen.getByLabelText(/What is wrong/), { target: { value: "Pedal goes to the floor" } })
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }))
    confirm()
    send()

    await waitFor(() => expect(state.inspect).toHaveBeenCalledTimes(1))
    const body = state.inspect.mock.calls[0][1]
    expect(body.answers[0]).toEqual({ key: "brakes", response: "problem", note: "Pedal goes to the floor" })
    expect(body.photos.map((p) => p.key)).toEqual(["brakes"])
    expect(await screen.findByText("Do not drive this vehicle")).toBeInTheDocument()
    expect(screen.getByText(/Brakes failed the inspection/)).toBeInTheDocument()
    expect(localInspection(7, 41)).toMatchObject({ result: "fail_critical" })
  })

  it("out of signal it is saved on the phone, and the answer is worked out here", async () => {
    state.inspect.mockResolvedValue({ queued: true })
    renderForm()
    allOk()
    choose("Fluids and leaks", "Problem")
    fireEvent.change(screen.getByLabelText(/What is wrong/), { target: { value: "Coolant low" } })
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }))
    confirm()
    send()
    expect(await screen.findByText(/Saved on this phone/)).toBeInTheDocument()
    expect(screen.getByText(/You can start the trip/)).toBeInTheDocument()
    expect(localInspection(7, 41)).toMatchObject({ result: "fail_noncritical" })
  })

  it("keeps the same reference when sent again after a failure", async () => {
    state.inspect.mockRejectedValueOnce(new Error("Trackify took too long to answer.")).mockResolvedValueOnce({ data: { result: "pass" } })
    renderForm()
    allOk()
    confirm()
    send()
    expect(await screen.findByText("Trackify took too long to answer.")).toBeInTheDocument()
    send()
    await screen.findByText("Inspection passed")
    const [first, second] = state.inspect.mock.calls.map(([, b]) => b.clientRef)
    expect(second).toBe(first)
  })
})
