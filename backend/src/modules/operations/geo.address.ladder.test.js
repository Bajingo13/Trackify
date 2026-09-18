import { test } from "node:test";
import assert from "node:assert/strict";
import { addressLadder, withinScope, mentionsAnyTerm } from "./geo.address.js";

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

test("the area already being worked in is asked about first", () => {
  /*
   * Measured with an origin already placed in Balayan. "Villa" alone returns
   * Northern Samar (415km), Masbate (429km), Aurora (205km), Cagayan (495km)
   * and Southern Leyte (626km) — not one in Batangas. "Villa, Batangas"
   * returns Nueva Villa in Alangilan and Twin Villa Subdivision.
   */
  const steps = addressLadder("Villa", { context: "Batangas" });
  assert.equal(steps[0], "Villa, Batangas");
  assert.ok(steps.includes("Villa"), "the unqualified search must still follow");
});

test("the unqualified search still follows, so a trip to another province is findable", () => {
  // A haul from Balayan to Davao is ordinary. Scoping to the origin's province
  // must be a preference, never a cage.
  const steps = addressLadder("Davao City", { context: "Batangas" });
  assert.ok(steps.indexOf("Davao City") > steps.indexOf("Davao City, Batangas"));
});

test("the area is not repeated when it was already typed", () => {
  const steps = addressLadder("Balayan, Batangas", { context: "Batangas" });
  assert.equal(steps[0], "Balayan, Batangas");
  assert.ok(!steps.includes("Balayan, Batangas, Batangas"), JSON.stringify(steps));
});

test("no area means the ladder is exactly as it was", () => {
  assert.deepEqual(addressLadder("Villa"), addressLadder("Villa", { context: null }));
});

/* ---- the answer has to be in the place we asked about ---- */

/*
 * Measured on fresh, uncached responses: Nominatim answers "Villa, Batangas"
 * with eight subdivisions named Villa at one moment, and at another ignores
 * "Villa" and returns whatever matches the province word — an expressway in
 * Cavite, a rail line. The identical URL, both times. So the search cannot
 * assume a scoped rung answered the scoped question.
 */

const result = (province, city, label) => ({ label, address: { province, city } });

test("a result from another province is not an answer to a scoped search", () => {
  const kept = withinScope(
    [
      result("Cavite", "Silang", "Cavite–Batangas Expressway, Barangay Toledo, Silang, Cavite"),
      result("Batangas", "Lipa", "Villa Santo Niño, Lipa, Batangas"),
    ],
    "Batangas"
  );
  assert.equal(kept.length, 1);
  assert.match(kept[0].label, /Villa Santo Niño/);
});

test("the province is judged from the address, never from the name", () => {
  // "Cavite–Batangas Expressway" carries the word Batangas in its name while
  // sitting in Cavite. Matching on the label would admit the one result this
  // check exists to reject.
  const kept = withinScope(
    [result("Cavite", "Silang", "Cavite–Batangas Expressway, Silang, Cavite")],
    "Batangas"
  );
  assert.deepEqual(kept, []);
});

test("something odd but genuinely inside the province is kept", () => {
  // This enforces where, not relevance. A rail line really is in Batangas, and
  // deciding it is not worth suggesting is Nominatim's ranking job, not a
  // filter's.
  const kept = withinScope([result("Batangas", "Lipa", "PNR Batangas Line, Lipa, Batangas")], "Batangas");
  assert.equal(kept.length, 1);
});

test("a result with no province recorded is not thrown away", () => {
  // Plenty of OpenStreetMap entries carry no province at all. Absence is not
  // evidence of being somewhere else, and discarding them would lose real
  // places to a missing field.
  assert.equal(withinScope([result(null, null, "Somewhere")], "Batangas").length, 1);
});

test("no scope means nothing is filtered", () => {
  const rows = [result("Cavite", "Silang", "a"), result("Batangas", "Lipa", "b")];
  assert.deepEqual(withinScope(rows, null), rows);
  assert.deepEqual(withinScope(rows, ""), rows);
});

/* ---- the answer has to be about what was actually typed ---- */

test("a result that matches only the province we appended is not an answer", () => {
  // Measured: searching "Villa" with an origin in Batangas returned "PNR
  // Batangas Line", a railway. It carries the word this code added and not the
  // word the dispatcher typed.
  const kept = mentionsAnyTerm(
    [{ label: "PNR Batangas Line, Dao Street, Barangay Tambo, Lipa, Batangas" }],
    "Villa"
  );
  assert.deepEqual(kept, []);
});

test("a result carrying the typed word is kept", () => {
  const kept = mentionsAnyTerm(
    [
      { label: "Villa Santo Niño, Lipa, Batangas" },
      { label: "PNR Batangas Line, Lipa, Batangas" },
    ],
    "Villa"
  );
  assert.equal(kept.length, 1);
  assert.match(kept[0].label, /Villa Santo Niño/);
});

test("any one of the typed words is enough", () => {
  // An address rarely comes back worded exactly as it was typed.
  const kept = mentionsAnyTerm([{ label: "De Joya Compound, Alangilan, Batangas City" }], "de joya avenue");
  assert.equal(kept.length, 1);
});

test("nothing distinctive enough to judge by throws nothing away", () => {
  // A house number or two initials are not grounds to discard an answer.
  const rows = [{ label: "Balayan, Batangas" }];
  assert.deepEqual(mentionsAnyTerm(rows, "0394"), rows);
  assert.deepEqual(mentionsAnyTerm(rows, ""), rows);
  assert.deepEqual(mentionsAnyTerm(rows, "st ave"), rows);
});

test("a single place name yields exactly one attempt", () => {
  // Nothing to give up. Walking a ladder of one is the ordinary case and must
  // not cost extra calls to a service that allows one request a second.
  assert.deepEqual(ladderFor("Balayan"), ["Balayan"]);
});
