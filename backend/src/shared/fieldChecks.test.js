import { test } from "node:test";
import assert from "node:assert/strict";
import { textField, emailField, phoneField, firstProblem } from "./fieldChecks.js";

/**
 * Checks on what a person types into a form.
 *
 * These exist because the database was doing the checking. A name longer than
 * the column came back as HTTP 500 with "Data too long for column
 * 'customer_name'" — which tells the person filling in the form that the
 * system is broken, when in fact their entry is a few characters too long and
 * they could fix it immediately if anybody said so.
 */

test("a value longer than its column is refused, with the limit in the message", () => {
  const problem = textField("A".repeat(250), { label: "Customer name", max: 200 });
  assert.match(problem, /too long/);
  // The number matters: "too long" with no limit is a guessing game, and the
  // person is usually pasting from somewhere.
  assert.match(problem, /250 characters/);
  assert.match(problem, /most that fits is 200/);
});

test("a value exactly at the limit is accepted", () => {
  // Off-by-one here would reject a legitimate entry with no way to tell why.
  assert.equal(textField("A".repeat(200), { label: "Name", max: 200 }), null);
});

test("a required field must actually contain something", () => {
  assert.match(textField("", { label: "Customer name", max: 200, required: true }), /required/);
  assert.match(textField("    ", { label: "Customer name", max: 200, required: true }), /required/);
  assert.equal(textField("Ana", { label: "Customer name", max: 200, required: true }), null);
});

test("an optional field left blank is not a problem", () => {
  assert.equal(textField("", { label: "Contact", max: 200 }), null);
  assert.equal(textField(undefined, { label: "Contact", max: 200 }), null);
  assert.equal(textField(null, { label: "Contact", max: 200 }), null);
});

test("something that is plainly not an email address is refused", () => {
  for (const bad of ["not-an-email", "a@b", "@example.com", "ana@", "two words@example.com", "ana@example"]) {
    assert.ok(emailField(bad), `accepted ${bad}`);
  }
});

test("addresses people actually have are accepted", () => {
  /*
   * A regex strict enough to satisfy a standards document rejects real
   * customers. These are the shapes that turn up in practice here.
   */
  for (const ok of [
    "ana.reyes@example.com",
    "ana+billing@example.com.ph",
    "a_b-c@sub.domain.example",
    "dispatch@astreablue.com",
  ]) {
    assert.equal(emailField(ok), null, `refused ${ok}`);
  }
});

test("an email is optional unless it is asked for", () => {
  assert.equal(emailField(""), null);
  assert.equal(emailField(undefined), null);
  assert.match(emailField("", { required: true }), /required/);
});

test("a phone number may be written the way people write it", () => {
  for (const ok of ["09171234567", "+63 917 123 4567", "(082) 123-4567", "02-5310-0423"]) {
    assert.equal(phoneField(ok), null, `refused ${ok}`);
  }
  assert.ok(phoneField("call me"), "accepted letters as a phone number");
});

test("the first problem is the one reported", () => {
  // A form that reports the last fault, or all of them at once, sends somebody
  // hunting. The first is where they should look.
  assert.equal(firstProblem(null, "second", "third"), "second");
  assert.equal(firstProblem(null, null), null);
});
