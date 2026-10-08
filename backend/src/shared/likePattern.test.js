import { test } from "node:test";
import assert from "node:assert/strict";
import { containsPattern, startsWithPattern, MAX_SEARCH_LENGTH } from "./likePattern.js";

test("a starts-with pattern has no leading wildcard, so an index can serve it", () => {
  assert.equal(startsWithPattern(" TT-00 "), "TT-00%");
  assert.equal(startsWithPattern("TT_0"), "TT\\_0%");
  assert.equal(startsWithPattern("%"), "\\%%");
});

test("an ordinary term is wrapped so it matches anywhere in the column", () => {
  assert.equal(containsPattern("TT-0042"), "%TT-0042%");
});

test("surrounding whitespace is ignored", () => {
  assert.equal(containsPattern("  acme  "), "%acme%");
});

test("LIKE wildcards typed by a person are matched literally", () => {
  assert.equal(containsPattern("%"), "%\\%%");
  assert.equal(containsPattern("TT_0042"), "%TT\\_0042%");
});

test("a backslash is escaped so it cannot escape the next character", () => {
  assert.equal(containsPattern("a\\%"), "%a\\\\\\%%");
});

test("a missing term does not throw", () => {
  assert.equal(containsPattern(undefined), "%%");
  assert.equal(containsPattern(null), "%%");
});

test("an enormous term is cut to a sensible length", () => {
  const pattern = containsPattern("x".repeat(5000));
  assert.equal(pattern.length, MAX_SEARCH_LENGTH + 2);
});
