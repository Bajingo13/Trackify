import { describe, test, expect } from "vitest"
import { matchesBarangay, barangayOptions } from "./tripFilters"

/**
 * Barangay filtering for the trips list.
 *
 * These were unreachable inside the page's useMemo, so they were taken on
 * trust. The cases that matter are the ones where being wrong is invisible: a
 * trip created before the address columns existed, a filter that quietly
 * matches everything, and the either-end rule that makes a shared origin
 * barangay return both directions of travel.
 */

const trip = (originBarangay, destBarangay) => ({
  originAddress: originBarangay ? { barangay: originBarangay } : null,
  destAddress: destBarangay ? { barangay: destBarangay } : null,
})

describe("matchesBarangay", () => {
  test("matches the destination barangay", () => {
    expect(matchesBarangay(trip("Poblacion District", "Sasa"), "Sasa")).toBe(true)
  })

  test("matches the origin barangay too", () => {
    // "What did we run to Sasa" and "what did we collect from Sasa" are one
    // question asked from opposite directions.
    expect(matchesBarangay(trip("Sasa", "Magugpo"), "Sasa")).toBe(true)
  })

  test("excludes a trip that touches neither end", () => {
    expect(matchesBarangay(trip("Poblacion District", "Magugpo"), "Sasa")).toBe(false)
  })

  test("no filter selected keeps everything", () => {
    // The select's resting value. Treating "all" as a barangay name would
    // empty the list the moment the page loaded.
    expect(matchesBarangay(trip("Sasa", "Magugpo"), "all")).toBe(true)
    expect(matchesBarangay(trip("Sasa", "Magugpo"), "")).toBe(true)
    expect(matchesBarangay(trip("Sasa", "Magugpo"), undefined)).toBe(true)
  })

  test("a trip with no address is excluded by a real filter, not crashed on", () => {
    // Every trip created before migration 028, and every one typed by hand
    // without a geocoder match, has no address at all.
    const bare = { originAddress: null, destAddress: null }
    expect(matchesBarangay(bare, "Sasa")).toBe(false)
    expect(matchesBarangay(bare, "all")).toBe(true)
    expect(matchesBarangay({}, "Sasa")).toBe(false)
    expect(matchesBarangay(undefined, "Sasa")).toBe(false)
  })

  test("the comparison is exact, matching the server", () => {
    // The server compares exactly so its index is used. A looser match here
    // would make the list and a scoped fetch disagree about what belongs.
    expect(matchesBarangay(trip(null, "Sasa"), "sasa")).toBe(false)
    expect(matchesBarangay(trip(null, "Sasa"), "Sas")).toBe(false)
  })
})

describe("barangayOptions", () => {
  test("collects both ends, without repeats, sorted", () => {
    const options = barangayOptions([
      trip("Poblacion District", "Sasa"),
      trip("Poblacion District", "Magugpo"),
      trip(null, "Sasa"),
    ])
    expect(options).toEqual(["Magugpo", "Poblacion District", "Sasa"])
  })

  test("trips with no address contribute nothing", () => {
    // An empty result is the signal to hide the control: offering a filter
    // that can only return nothing is worse than offering none.
    expect(barangayOptions([{ originAddress: null, destAddress: null }, {}])).toEqual([])
    expect(barangayOptions([])).toEqual([])
    expect(barangayOptions()).toEqual([])
  })

  test("names are ordered the way a person reads them", () => {
    const options = barangayOptions([trip("Zapote", null), trip("Agdao", null), trip("Buhangin", null)])
    expect(options).toEqual(["Agdao", "Buhangin", "Zapote"])
  })
})
