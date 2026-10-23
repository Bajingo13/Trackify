import { describe, expect, it } from "vitest";
import { mapsHref } from "./mapsHref";

const BASE = "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=";

describe("the Navigate link", () => {
  it("sends the pin when there is one, ahead of the address", () => {
    expect(mapsHref({ lat: 7.4, lng: 125.8, address: "Tagum Hub, Tagum City" })).toBe(`${BASE}7.4,125.8`);
  });

  it("takes coordinates stored as text", () => {
    expect(mapsHref({ lat: "7.0731", lng: "125.6128" })).toBe(`${BASE}7.0731,125.6128`);
  });

  it("falls back to the address when the pin is missing or unusable", () => {
    const address = "Redwood Cold Storage, Davao City";
    const expected = `${BASE}Redwood%20Cold%20Storage%2C%20Davao%20City`;
    expect(mapsHref({ lat: null, lng: null, address })).toBe(expected);
    expect(mapsHref({ lat: "", lng: "", address })).toBe(expected);
    expect(mapsHref({ lat: "abc", lng: 125.6, address })).toBe(expected);
    expect(mapsHref({ lat: 0, lng: 0, address })).toBe(expected);
    expect(mapsHref({ lat: 95, lng: 125.6, address })).toBe(expected);
  });

  it("encodes characters that would otherwise break the link", () => {
    expect(mapsHref({ address: "Bldg #2 & Annex, Lanang" })).toBe(`${BASE}Bldg%20%232%20%26%20Annex%2C%20Lanang`);
  });

  it("offers nothing when there is neither a pin nor an address", () => {
    expect(mapsHref({ address: "   " })).toBeNull();
    expect(mapsHref({})).toBeNull();
    expect(mapsHref()).toBeNull();
  });
});
