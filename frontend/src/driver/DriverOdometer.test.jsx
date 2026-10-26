import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ odometer: vi.fn() }))

vi.mock("./driverApi", () => ({
  currentDriverId: () => 7,
  driverOdometer: (...a) => state.odometer(...a),
}))
vi.mock("./native", () => ({ tap: vi.fn() }))
vi.mock("./PhotoPick", () => ({
  default: ({ onFile, takeLabel }) => (
    <button type="button" onClick={() => onFile(new File(["x"], "dash.jpg", { type: "image/jpeg" }))}>{takeLabel}</button>
  ),
}))

const { default: DriverOdometer, readKm } = await import("./DriverOdometer")
const { localOdometer, needsOdometerReading, startKmOf } = await import("./odometerLocal")

const type = (v) => fireEvent.change(screen.getByLabelText(/Odometer \(km\)/), { target: { value: v } })

describe("an odometer reading", () => {
  beforeEach(() => {
    localStorage.clear()
    state.odometer.mockReset().mockResolvedValue({ success: true })
  })

  it("reads kilometres as numbers, to one decimal", () => {
    expect(readKm("120,150")).toBe(120150)
    expect(readKm("98765.43")).toBe(98765.4)
    for (const bad of ["", "abc", "-1", "12 km"]) expect(readKm(bad)).toBeNull()
  })

  it("the start reading is saved, remembered here, and goes straight on to Start", async () => {
    const onDone = vi.fn()
    render(<DriverOdometer tripId={41} kind="start" lastKnownKm={120000} onBack={() => {}} onDone={onDone} />)
    expect(screen.getByText(/Last figure on record for this vehicle: 120,000 km/)).toBeInTheDocument()
    type("120150")
    fireEvent.click(screen.getByRole("button", { name: "Save and start trip" }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(120150))
    const [tripId, body] = state.odometer.mock.calls[0]
    expect(tripId).toBe(41)
    expect(body).toMatchObject({ kind: "start", valueKm: 120150, photo: null })
    expect(body.clientRef).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(localOdometer(7, 41)).toEqual({ start: 120150 })
  })

  it("the end reading cannot be lower than the start, or a whole country further on", async () => {
    render(<DriverOdometer tripId={41} kind="end" startKm={120150} onBack={() => {}} onDone={vi.fn()} />)
    expect(screen.getByText(/Start reading: 120,150 km/)).toBeInTheDocument()
    type("120100")
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }))
    expect(await screen.findByText(/lower than the start reading/)).toBeInTheDocument()
    type("130000")
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }))
    expect(await screen.findByText(/more than 3,000 km/)).toBeInTheDocument()
    expect(state.odometer).not.toHaveBeenCalled()
  })

  it("takes a dashboard photo if there is one, and does not need one", async () => {
    const onDone = vi.fn()
    render(<DriverOdometer tripId={41} kind="end" startKm={120150} onBack={() => {}} onDone={onDone} />)
    type("120400")
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }))
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(state.odometer.mock.calls[0][1].photo.name).toBe("dash.jpg")
  })

  it("says what went wrong and keeps the same reference when sent again", async () => {
    state.odometer.mockRejectedValueOnce(new Error("Trackify took too long to answer.")).mockResolvedValueOnce({ success: true })
    const onDone = vi.fn()
    render(<DriverOdometer tripId={41} kind="start" onBack={() => {}} onDone={onDone} />)
    type("120150")
    fireEvent.click(screen.getByRole("button", { name: "Save and start trip" }))
    expect(await screen.findByText("Trackify took too long to answer.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Save and start trip" }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const [first, second] = state.odometer.mock.calls.map(([, b]) => b.clientRef)
    expect(second).toBe(first)
  })
})

describe("whether a reading is still needed", () => {
  const trip = (status, odometer) => ({ status, odometer })
  const required = (extra = {}) => ({ required: true, start: null, end: null, ...extra })

  it("only when the company requires it, at its own step, and not already given", () => {
    expect(needsOdometerReading(trip("released", { required: false }), null, "start")).toBe(false)
    expect(needsOdometerReading(trip("released"), null, "start")).toBe(false)
    expect(needsOdometerReading(trip("released", required()), null, "start")).toBe(true)
    expect(needsOdometerReading(trip("released", required()), { start: 120150 }, "start")).toBe(false)
    expect(needsOdometerReading(trip("released", required({ start: { effectiveKm: 120150 } })), null, "start")).toBe(false)
    expect(needsOdometerReading(trip("released", required()), null, "end")).toBe(false)
    expect(needsOdometerReading(trip("in_transit", required()), null, "end")).toBe(true)
    expect(needsOdometerReading(trip("in_transit", required()), { end: 120400 }, "end")).toBe(false)
  })

  it("checks the end against the server's start, or this phone's", () => {
    expect(startKmOf(trip("in_transit", required({ start: { effectiveKm: 120150 } })), { start: 1 })).toBe(120150)
    expect(startKmOf(trip("in_transit", required()), { start: 120150 })).toBe(120150)
    expect(startKmOf(trip("in_transit", required()), null)).toBeNull()
  })
})
