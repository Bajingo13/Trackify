import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  search: vi.fn(),
  savedSearch: vi.fn(),
  savePlace: vi.fn(),
  markUsed: vi.fn(),
  mapProps: null,
}))

vi.mock("../../services/geoService", () => ({
  searchPlacesBest: (...args) => state.search(...args),
  searchSavedPlaces: (...args) => state.savedSearch(...args),
  savePlace: (...args) => state.savePlace(...args),
  markPlaceUsed: (...args) => state.markUsed(...args),
  getRoute: () => Promise.resolve(null),
  describePoint: () => Promise.resolve(null),
  PRECISION_LABEL: {
    house: "Exact address",
    street: "Street",
    barangay: "Barangay",
    city: "City / municipality",
    province: "Province",
    area: "Approximate",
  },
  isDeliverable: (p) => p === "house" || p === "street" || p === "barangay",
}))

vi.mock("./MapView", () => ({
  default: (props) => {
    state.mapProps = props
    return <div data-testid="map" />
  },
}))

vi.mock("./map.css", () => ({}))

const { default: LocationPicker } = await import("./LocationPicker")

/**
 * The trip route picker.
 *
 * Every case here comes from a real report: a dispatcher typed two Batangas
 * addresses, got an empty box, a list showing results for the previous search,
 * and a map sitting over Mindanao. None of this component was covered before.
 */

const hit = (label, precision = "city") => ({
  label,
  lat: 13.9381793,
  lng: 120.7294945,
  precision,
  address: { city: "Balayan", province: "Batangas" },
})

const found = (results, matchedQuery = null) => ({
  results,
  matchedQuery,
  degraded: Boolean(matchedQuery),
})

const originInput = () => screen.getAllByPlaceholderText("Type the whole address…")[0]

describe("LocationPicker", () => {
  beforeEach(() => {
    state.search.mockReset()
    // No saved places unless a test says otherwise, so the geocoder cases stay
    // about the geocoder.
    state.savedSearch.mockReset().mockResolvedValue([])
    state.savePlace.mockReset().mockResolvedValue({ success: true })
    state.markUsed.mockReset()
    state.mapProps = null
  })

  afterEach(() => vi.restoreAllMocks())

  it("opens on the Philippines, not on Davao", () => {
    // It used to centre on [125.6, 7.07]. Anyone working in Luzon opened the
    // picker looking at Mindanao and concluded the map was broken.
    state.search.mockResolvedValue(found([]))
    render(<LocationPicker onClose={vi.fn()} onDone={vi.fn()} />)

    const [lng, lat] = state.mapProps.center
    expect(lng).toBeGreaterThan(115)
    expect(lng).toBeLessThan(128)
    expect(lat).toBeGreaterThan(8)
    expect(lat).toBeLessThan(19)
  })

  it("says so when an address is not on the map, instead of showing nothing", async () => {
    // An empty dropdown and a broken search look identical on screen. This is
    // the single most misleading thing the old version did.
    state.search.mockResolvedValue(found([]))
    render(<LocationPicker onClose={vi.fn()} onDone={vi.fn()} />)

    fireEvent.change(originInput(), { target: { value: "0394 villa esperanza phase 2, Balayan" } })

    expect(await screen.findByText(/Not on the map/, {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByText(/Click the exact spot on the map/)).toBeTruthy()
  })

  it("explains when it had to search for something less exact", async () => {
    state.search.mockResolvedValue(found([hit("Balayan, Batangas")], "Balayan Batangas"))
    render(<LocationPicker onClose={vi.fn()} onDone={vi.fn()} />)

    fireEvent.change(originInput(), { target: { value: "0394 villa esperanza phase 2, Balayan Batangas" } })

    expect(await screen.findByText(/Couldn’t find that exact address/, {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByText(/Balayan Batangas/)).toBeTruthy()
  })

  it("keeps the address as typed when the pin is only the closest match", async () => {
    // "0394 Villa Esperanza Phase 2" is the only part nobody can reconstruct
    // from the map. Replacing it with "Balayan, Batangas" throws it away.
    state.search.mockResolvedValue(found([hit("Balayan, Batangas")], "Balayan Batangas"))
    render(<LocationPicker onClose={vi.fn()} onDone={vi.fn()} />)

    const typed = "0394 villa esperanza phase 2, Balayan Batangas"
    fireEvent.change(originInput(), { target: { value: typed } })

    fireEvent.click(await screen.findByText("Balayan, Batangas", {}, { timeout: 3000 }))

    await waitFor(() => expect(screen.getByText(/pin on Balayan, Batangas/)).toBeTruthy())
    // The field now shows the typed address as the placed point's label.
    expect(screen.getAllByPlaceholderText(typed.slice(0, 42)).length).toBeGreaterThan(0)
  })

  it("ignores a slow earlier search that lands after a newer one", async () => {
    /*
     * The reported bug: typing "Caloocan" showed results for the Balayan search
     * before it. The old cleanup cleared the debounce timer but never cancelled
     * the request already in flight, so whichever response arrived last won.
     */
    let resolveOld
    const oldSearch = new Promise((r) => { resolveOld = r })
    state.search
      .mockImplementationOnce(() => oldSearch)
      .mockImplementationOnce(() => Promise.resolve(found([hit("Caloocan, Metro Manila")])))

    render(<LocationPicker onClose={vi.fn()} onDone={vi.fn()} />)

    fireEvent.change(originInput(), { target: { value: "Balayan" } })
    await waitFor(() => expect(state.search).toHaveBeenCalledTimes(1), { timeout: 3000 })

    fireEvent.change(originInput(), { target: { value: "Caloocan" } })
    await waitFor(() => expect(state.search).toHaveBeenCalledTimes(2), { timeout: 3000 })

    // The superseded search answers last, which is exactly the losing order.
    resolveOld(found([hit("Barangay Santol, Balayan, Batangas", "barangay")]))

    expect(await screen.findByText("Caloocan, Metro Manila", {}, { timeout: 3000 })).toBeTruthy()
    await waitFor(() => {
      expect(screen.queryByText("Barangay Santol, Balayan, Batangas")).toBeNull()
    })
  })

  it("searches within the province of a point already placed", async () => {
    /*
     * The reported complaint: with an origin already set in Balayan, typing a
     * bare name suggested barangays hundreds of kilometres away. Setting one
     * end of a trip says where the work is, and the search has to use it.
     */
    state.search.mockResolvedValue(found([hit("Balayan, Batangas", "city")]))
    render(<LocationPicker
      value={{ origin: { lat: 13.94, lng: 120.73, label: "Balayan", address: { city: "Balayan", province: "Batangas" } } }}
      onClose={vi.fn()}
      onDone={vi.fn()}
    />)

    // A field with a point already placed shows that place as its placeholder,
    // so the one still offering the default prompt is the destination.
    const destination = screen.getByPlaceholderText("Type the whole address…")
    fireEvent.change(destination, { target: { value: "Villa" } })

    await waitFor(() => expect(state.search).toHaveBeenCalled(), { timeout: 3000 })
    expect(state.search.mock.calls[0][2]).toBe("Batangas")
  })

  it("shows how far away a suggestion is", async () => {
    // A name cannot tell you a suggestion is in another region; the number can.
    state.search.mockResolvedValue(found([{ ...hit("Barangay Villa, Lavezares, Northern Samar", "barangay"), distanceKm: 415 }]))
    render(<LocationPicker onClose={vi.fn()} onDone={vi.fn()} />)

    fireEvent.change(originInput(), { target: { value: "Villa" } })

    expect(await screen.findByText(/415 km away/, {}, { timeout: 3000 })).toBeTruthy()
  })

  const savedPlace = (over = {}) => ({
    id: 5,
    label: "Villa Esperanza Phase 2",
    lat: 13.93,
    lng: 120.72,
    precision: "house",
    saved: true,
    address: {},
    ...over,
  })

  it("offers the company's own places before anything the geocoder found", async () => {
    /*
     * The case this whole feature exists for: OpenStreetMap has never heard of
     * Villa Esperanza and never will, so the pin somebody here dropped is not
     * the better answer, it is the only one.
     */
    state.savedSearch.mockResolvedValue([savedPlace()])
    state.search.mockResolvedValue(found([hit("Balayan, Batangas", "city")], "Balayan Batangas"))
    render(<LocationPicker onClose={vi.fn()} onDone={vi.fn()} />)

    fireEvent.change(originInput(), { target: { value: "villa esp" } })

    expect(await screen.findByText("Villa Esperanza Phase 2", {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByText("saved")).toBeTruthy()
    // No apology for an inexact match when a saved place answered exactly.
    expect(screen.queryByText(/Couldn’t find that exact address/)).toBeNull()
  })

  it("a saved place keeps its own name, and its use is counted", async () => {
    // The company's name for it is more use downstream than whatever somebody
    // typed to find it.
    state.savedSearch.mockResolvedValue([savedPlace()])
    state.search.mockResolvedValue(found([]))
    render(<LocationPicker onClose={vi.fn()} onDone={vi.fn()} />)

    fireEvent.change(originInput(), { target: { value: "villa" } })
    fireEvent.click(await screen.findByText("Villa Esperanza Phase 2", {}, { timeout: 3000 }))

    await waitFor(() => expect(state.markUsed).toHaveBeenCalledWith(5))
    expect(await screen.findByText("saved place")).toBeTruthy()
  })

  it("a point can be kept, so nobody has to find it a second time", async () => {
    state.search.mockResolvedValue(found([hit("Balayan, Batangas", "city")], "Balayan Batangas"))
    render(<LocationPicker onClose={vi.fn()} onDone={vi.fn()} />)

    fireEvent.change(originInput(), { target: { value: "0394 villa esperanza, Balayan" } })
    fireEvent.click(await screen.findByText("Balayan, Batangas", {}, { timeout: 3000 }))

    fireEvent.click(await screen.findByText("Save this place"))
    fireEvent.change(screen.getByPlaceholderText("What do people here call it?"), {
      target: { value: "Villa Esperanza Phase 2" },
    })
    fireEvent.click(screen.getByText("Save"))

    await waitFor(() => expect(state.savePlace).toHaveBeenCalledTimes(1))
    const sent = state.savePlace.mock.calls[0][0]
    expect(sent.label).toBe("Villa Esperanza Phase 2")
    // The point is the whole value of saving it.
    expect(sent.lat).toBe(13.9381793)
    expect(sent.lng).toBe(120.7294945)
  })

  it("saving without a name is refused rather than saved as blank", async () => {
    state.search.mockResolvedValue(found([hit("Balayan, Batangas", "city")]))
    render(<LocationPicker onClose={vi.fn()} onDone={vi.fn()} />)

    fireEvent.change(originInput(), { target: { value: "balayan" } })
    fireEvent.click(await screen.findByText("Balayan, Batangas", {}, { timeout: 3000 }))

    fireEvent.click(await screen.findByText("Save this place"))
    fireEvent.change(screen.getByPlaceholderText("What do people here call it?"), { target: { value: "   " } })
    fireEvent.click(screen.getByText("Save"))

    expect(await screen.findByText("Give it a name.")).toBeTruthy()
    expect(state.savePlace).not.toHaveBeenCalled()
  })

  it("does not search until there is enough to search for", async () => {
    // One request a second is all the geocoder allows; spending them on "de"
    // costs the search that matters.
    state.search.mockResolvedValue(found([]))
    render(<LocationPicker onClose={vi.fn()} onDone={vi.fn()} />)

    fireEvent.change(originInput(), { target: { value: "de" } })
    await new Promise((r) => setTimeout(r, 600))
    expect(state.search).not.toHaveBeenCalled()
  })

  it("cannot confirm a route until both ends are placed", () => {
    state.search.mockResolvedValue(found([]))
    render(<LocationPicker onClose={vi.fn()} onDone={vi.fn()} />)

    expect(screen.getByText("Use this route").disabled).toBe(true)
  })
})
