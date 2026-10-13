import { describe, expect, it } from "vitest"
import { ARRIVAL_RADIUS_M, distanceMeters, hasArrived } from "./arrival"

const pin = { destLat: 7.5, destLng: 125.9 }

describe("distance to the drop-off", () => {
  it("measures metres between two points", () => {
    expect(distanceMeters({ lat: 7.5, lng: 125.9 }, { lat: 7.5, lng: 125.9 })).toBe(0)
    // 0.001 degrees of latitude is about 111 m anywhere on Earth
    const d = distanceMeters({ lat: 7.5, lng: 125.9 }, { lat: 7.501, lng: 125.9 })
    expect(d).toBeGreaterThan(105)
    expect(d).toBeLessThan(117)
  })
})

describe("has the truck arrived", () => {
  it("is true inside the radius and false outside it", () => {
    expect(hasArrived({ lat: 7.5005, lng: 125.9005 }, pin)).toBe(true) // ~75 m
    expect(hasArrived({ lat: 7.502, lng: 125.9 }, pin)).toBe(false) // ~220 m
    expect(ARRIVAL_RADIUS_M).toBe(150)
  })

  it("honours a radius it is given", () => {
    expect(hasArrived({ lat: 7.502, lng: 125.9 }, pin, 300)).toBe(true)
  })

  it("can never arrive at a pin that was never set, or without a position", () => {
    expect(hasArrived({ lat: 7.5, lng: 125.9 }, { destLat: null, destLng: null })).toBe(false)
    expect(hasArrived({ lat: 7.5, lng: 125.9 }, {})).toBe(false)
    expect(hasArrived(null, pin)).toBe(false)
    expect(hasArrived({ lat: NaN, lng: 125.9 }, pin)).toBe(false)
  })
})
