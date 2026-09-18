import { test } from "node:test";
import assert from "node:assert/strict";
import { addressLadder } from "./geo.address.js";

/**
 * The order in which an address gives up its components.
 *
 * Every expectation here was measured against Nominatim with two addresses off
 * a real delivery note, not reasoned about. The searches and their answers:
 *
 *   "0394 villa esperanza phase 2, Balayan Batangas"  → nothing
 *   "villa esperanza phase 2 Balayan"                 → nothing
 *   "villa esperanza Batangas"                        → nothing
 *   "Balayan Batangas"                                → the municipality
 *
 *   "de joya avenue alingilan batangas city"          → nothing
 *   "de joya alingilan batangas city"                 → nothing
 *   "de joya batangas city"                           → De Joya Compound,
 *                                                       Alangilan, Batangas City
 *
 * So the ladder has two jobs: reach "Balayan Batangas" for an address that is
 * genuinely not in the map, and reach "de joya batangas city" for one that is,
 * where a single misspelled word in the middle was hiding it.
 */

const ladderFor = (text) => addressLadder(text);

test("the address as typed is always tried first", () => {
  const steps = ladderFor("0394 villa esperanza phase 2, Balayan Batangas");
  assert.equal(steps[0], "0394 villa esperanza phase 2, Balayan Batangas");
});

test("a subdivision that is not in the map degrades to its municipality", () => {
  // Nothing containing "villa esperanza" returns a result, so the only useful
  // answer left is Balayan itself.
  const steps = ladderFor("0394 villa esperanza phase 2, Balayan Batangas");
  assert.ok(
    steps.includes("Balayan Batangas"),
    `the ladder never reaches the municipality: ${JSON.stringify(steps)}`
  );
});

test("a misspelled barangay is dropped so the place behind it can be found", () => {
  // "alingilan" is a misspelling of Alangilan, and on its own it is enough to
  // return nothing. Dropping it finds De Joya Compound.
  const steps = ladderFor("de joya avenue alingilan batangas city");
  assert.ok(
    steps.includes("de joya batangas city"),
    `the ladder never drops the misspelled middle: ${JSON.stringify(steps)}`
  );
});

test("a leading house number is given up early, before anything else is lost", () => {
  const steps = ladderFor("0394 villa esperanza, Balayan, Batangas");
  const withoutNumber = steps.indexOf("villa esperanza, Balayan, Batangas");
  const withoutStreet = steps.indexOf("Balayan, Batangas");
  assert.ok(withoutNumber > 0, "the house number is never dropped");
  assert.ok(
    withoutNumber < withoutStreet,
    "the street is given up before the house number, which loses precision for no reason"
  );
});

test("each step is tried before any coarser one", () => {
  // The ladder is only safe to walk top-down if it is genuinely ordered from
  // most specific to least: the first hit is returned, so a coarse entry
  // sitting too early would throw away a precise answer that was available.
  const steps = ladderFor("12 Rizal Street, Poblacion, Balayan, Batangas");
  const full = steps.indexOf("12 Rizal Street, Poblacion, Balayan, Batangas");
  const dropped = steps.indexOf("Poblacion, Balayan, Batangas");
  const coarsest = steps.indexOf("Batangas");
  assert.equal(full, 0);
  assert.ok(dropped > full);
  assert.ok(coarsest === -1 || coarsest > dropped);
});

test("noise words that are rarely in the map are dropped, but only after the real attempt", () => {
  const steps = ladderFor("de joya avenue alingilan batangas city");
  assert.equal(steps[0], "de joya avenue alingilan batangas city");
  assert.ok(steps.includes("de joya alingilan batangas city"), JSON.stringify(steps));
});

test("nothing is repeated, so no attempt is spent twice", () => {
  const steps = ladderFor("Balayan, Batangas");
  assert.equal(new Set(steps).size, steps.length, `repeats: ${JSON.stringify(steps)}`);
});

test("a query too short to search produces no attempts at all", () => {
  assert.deepEqual(ladderFor(""), []);
  assert.deepEqual(ladderFor("  "), []);
  assert.deepEqual(ladderFor("ab"), []);
  assert.deepEqual(ladderFor(null), []);
});

test("a single place name yields exactly one attempt", () => {
  // Nothing to give up. Walking a ladder of one is the ordinary case and must
  // not cost extra calls to a service that allows one request a second.
  assert.deepEqual(ladderFor("Balayan"), ["Balayan"]);
});
