import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePlusCode, encodePlusCode, recoverPlusCode, findPlusCode } from "./plusCode.js";

/**
 * Plus Code decoding.
 *
 * This is arithmetic written from a specification, which is exactly how the two
 * false claims got into the agreement earlier today — so it is pinned to values
 * worked out by hand and to one measurement against the real world.
 *
 * The first expectation I wrote here was wrong for the same reason: I assumed
 * "8FVC2222+22" was Zurich because Zurich is inside that square. It is not. The
 * code names the south-west corner cell of the square, and the difference
 * between those two things is the whole point of the digits after the pairs.
 */

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

test("the pairs place the point, most significant first", () => {
  // "8F" selects the 20-degree cell, "VC" the 1-degree cell inside it
  // (latitude 47..48, longitude 8..9), and "2222" are all the zero digit — so
  // this is that square's south-west corner, not the city inside it.
  const point = decodePlusCode("8FVC2222+22");
  assert.ok(near(point.lat, 47.0000625, 1e-6), `latitude was ${point.lat}`);
  assert.ok(near(point.lng, 8.0000625, 1e-6), `longitude was ${point.lng}`);
});

test("a code names the centre of its cell, not a corner", () => {
  // A corner is a point nobody meant. At eleven characters the cell is a few
  // metres across, which is the difference between a gate and the fence.
  const point = decodePlusCode("8FVC2222+22");
  assert.ok(point.lat > 47, "the centre must sit inside the cell, above its floor");
  assert.ok(point.lng > 8);
  assert.equal(point.latResolution > 0, true);
});

test("encoding and decoding return the same place", () => {
  for (const [lat, lng] of [
    [13.7824521, 121.0682723], // Alangilan, Batangas City
    [13.9381793, 120.7294945], // Balayan
    [14.5995, 120.9842], // Manila
    [-33.8688, 151.2093], // southern and eastern, to exercise both signs
    [0, 0],
  ]) {
    const back = decodePlusCode(encodePlusCode(lat, lng));
    assert.ok(near(back.lat, lat, 0.0002), `latitude ${lat} came back as ${back.lat}`);
    assert.ok(near(back.lng, lng, 0.0002), `longitude ${lng} came back as ${back.lng}`);
  }
});

test("a short code is recovered against a nearby point", () => {
  /*
   * Measured against the real world: this is the code from the reported
   * screenshot, recovered against Alangilan. Asking OpenStreetMap what is at
   * the result returns "De Joya Avenue, De Joya Compound, Alangilan, Dalig,
   * Batangas City" — the same street the dispatcher had typed by hand in an
   * earlier attempt, and could not find.
   */
  const point = recoverPlusCode("Q3HC+P3F", 13.7824521, 121.0682723);
  assert.ok(near(point.lat, 13.779312, 0.0005), `latitude was ${point.lat}`);
  assert.ok(near(point.lng, 121.070172, 0.0005), `longitude was ${point.lng}`);
});

test("a short code recovers to the nearer square when the reference is across a boundary", () => {
  // The missing characters cover a degree, about 110km, so the naive answer can
  // land in the neighbouring square. Recovery has to step back into the right one.
  const truth = { lat: 13.779312, lng: 121.070172 };
  const full = encodePlusCode(truth.lat, truth.lng);
  const short = full.slice(4);
  for (const [lat, lng] of [
    [13.78, 121.07],
    [13.3, 120.7],
    [14.2, 121.4],
  ]) {
    const point = recoverPlusCode(short, lat, lng);
    assert.ok(near(point.lat, truth.lat, 0.001), `from ${lat},${lng} latitude was ${point.lat}`);
    assert.ok(near(point.lng, truth.lng, 0.001), `from ${lat},${lng} longitude was ${point.lng}`);
  }
});

test("a full code needs no reference at all", () => {
  const full = encodePlusCode(13.7824521, 121.0682723);
  const point = recoverPlusCode(full, undefined, undefined);
  assert.ok(near(point.lat, 13.7824521, 0.0002));
});

test("the code is found inside an address and the rest is kept", () => {
  // The words beside the code are not decoration: for a short code they are the
  // reference it is measured from.
  const found = findPlusCode("Q3HC+P3F, Alangilan, Batangas City, Batangas");
  assert.equal(found.code, "Q3HC+P3F");
  assert.equal(found.short, true);
  assert.equal(found.rest, "Alangilan, Batangas City, Batangas");
});

test("an ordinary address is not mistaken for a code", () => {
  // The alphabet excludes vowels, which is what keeps this from firing on words.
  for (const text of [
    "0394 villa esperanza phase 2, Balayan Batangas",
    "de joya avenue alingilan batangas city",
    "Balayan, Batangas",
    "",
  ]) {
    assert.equal(findPlusCode(text), null, `matched a code inside "${text}"`);
  }
});

test("nonsense in the shape of a code decodes to nothing rather than somewhere", () => {
  // "A", "E", "I", "O", "U" are not in the alphabet. Silently treating an
  // unknown character as zero would put a pin in the sea.
  assert.equal(decodePlusCode("8FVCAAAA+22"), null);
  assert.equal(decodePlusCode(""), null);
  assert.equal(decodePlusCode(null), null);
});
