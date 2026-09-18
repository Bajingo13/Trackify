import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { precisionOf, formatAddress, geocodeStructured } from "./geo.address.js";

/**
 * Address precision, formatting, and the structured-search fallback.
 *
 * The search this replaced asked OpenStreetMap for no address detail at all, so
 * every result arrived as one display string and a city-centre pin was
 * indistinguishable from a street address. These cases pin the things that
 * decide whether a driver reaches a door: which rung of the address a match
 * actually reached, whether it reads the way a Philippine address is written,
 * and whether an unmapped house number still gets you to the street.
 */

test("a house number is the most exact rung", () => {
  assert.equal(
    precisionOf({ house_number: "123", road: "Rizal Street", suburb: "Poblacion", city: "Digos" }),
    "house"
  );
});

test("a street without a house number is a street, not an exact address", () => {
  assert.equal(precisionOf({ road: "Rizal Street", suburb: "Poblacion", city: "Digos" }), "street");
});

test("a barangay is recognised however OpenStreetMap happens to tag it", () => {
  // OSM has no barangay field. Depending on who mapped the area it arrives as
  // suburb, village, neighbourhood, quarter or hamlet, and a Philippine address
  // turns on it either way.
  for (const key of ["barangay", "suburb", "village", "neighbourhood", "quarter", "hamlet"]) {
    assert.equal(
      precisionOf({ [key]: "Poblacion", city: "Digos" }),
      "barangay",
      `${key} should count as a barangay`
    );
  }
});

test("a city match is reported as a city, so it cannot pass as a delivery point", () => {
  assert.equal(precisionOf({ city: "Davao City", state: "Davao del Sur" }), "city");
  assert.equal(precisionOf({ municipality: "Sta. Cruz", state: "Davao del Sur" }), "city");
});

test("a province match is not mistaken for a place", () => {
  assert.equal(precisionOf({ state: "Davao del Sur" }), "province");
});

test("nothing recognisable is reported as approximate rather than guessed", () => {
  assert.equal(precisionOf({}), "area");
  assert.equal(precisionOf(), "area");
});

test("an address reads the way it is written in the Philippines", () => {
  // House and street, barangay, city, province — and not OpenStreetMap's own
  // display_name, which leads with the country and reads as noise to a
  // dispatcher deciding where to send a truck.
  assert.equal(
    formatAddress({
      house_number: "123",
      road: "Rizal Street",
      suburb: "Poblacion",
      city: "Digos City",
      state: "Davao del Sur",
    }),
    "123 Rizal Street, Barangay Poblacion, Digos City, Davao del Sur"
  );
});

test("a barangay already named as one is not labelled twice", () => {
  assert.equal(
    formatAddress({ road: "Quirino Avenue", suburb: "Brgy. 76-A", city: "Davao City" }),
    "Quirino Avenue, Brgy. 76-A, Davao City"
  );
});

test("a city repeated as the municipality appears once", () => {
  // OSM frequently carries both, and printing "Digos City, Digos City" makes a
  // correct match look broken.
  assert.equal(
    formatAddress({ road: "National Highway", city: "Digos City", municipality: "Digos City" }),
    "National Highway, Digos City"
  );
});

test("a sparse address still produces something readable", () => {
  assert.equal(formatAddress({ city: "Tagum City", state: "Davao del Norte" }), "Tagum City, Davao del Norte");
  assert.equal(formatAddress({}), "");
});

/* ---- the structured-search fallback ---- */

/** Answers each Nominatim call from `reply`, and records the URLs asked for. */
async function withFetch(reply, fn) {
  const real = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => reply(String(url)) };
  };
  try {
    return await fn(urls);
  } finally {
    globalThis.fetch = real;
  }
}

const ROW = {
  lat: "7.1113",
  lon: "125.6547",
  display_name: "Rizal Street, Sasa, Davao City, Philippines",
  address: { road: "Rizal Street", suburb: "Sasa", city: "Davao City" },
};

test("an unmapped house number still gets you to the street", async () => {
  // Structured matching is all-or-nothing: every component it is given must
  // match. Most Philippine house numbers were never mapped, so a house number
  // alone would return an empty list even with the street sitting right there
  // in the data. Degrading to free text is what makes the field usable.
  const hits = await withFetch(
    (url) => (url.includes("street=") ? [] : [ROW]),
    () =>
      geocodeStructured({
        houseNumber: "99999",
        street: "Rizal Street",
        barangay: "Sasa",
        city: "Davao City",
      })
  );

  assert.equal(hits.length, 1);
  assert.equal(hits[0].precision, "street");
  assert.equal(hits[0].label, "Rizal Street, Barangay Sasa, Davao City");
});

test("a structured match that succeeds is not asked for twice", async () => {
  const urls = await withFetch(
    () => [ROW],
    async (urls) => {
      await geocodeStructured({ street: "Rizal Street", barangay: "Sasa", city: "Davao City" });
      return urls;
    }
  );

  assert.equal(urls.length, 1, "the fallback must not run when structured search answered");
  // The barangay travels in the city field — measured against Nominatim it
  // narrows to the Rizal Street in Sasa rather than every one in the city.
  assert.equal(new URL(urls[0]).searchParams.get("city"), "Sasa, Davao City");
});

test("nothing to search on is answered without calling out at all", async () => {
  const urls = await withFetch(
    () => [ROW],
    async (urls) => {
      const hits = await geocodeStructured({});
      assert.deepEqual(hits, []);
      return urls;
    }
  );

  assert.equal(urls.length, 0);
});
