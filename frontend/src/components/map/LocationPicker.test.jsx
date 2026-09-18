import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  search: vi.fn(),
  mapProps: null,
}))

vi.mock("../../services/geoService", () => ({
  searchPlacesBest: (...args) => state.search(...args),
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
