import { test } from "node:test";
import assert from "node:assert/strict";
import {
  manilaToday, daysUntilExpiry, expiryState, dueReminder, describeExpiry, dateOnly,
} from "./driverLicense.js";

/*
 * 2026-10-15 16:30 UTC is already 00:30 on the 16th in Manila. A server in UTC
 * that counted days its own way would tell a driver their licence "expires
 * today" for eight hours after it had, on their calendar, already expired.
 */
const LATE_UTC = new Date("2026-10-15T16:30:00Z");
const NOON_UTC = new Date("2026-10-15T04:00:00Z");

test("today is the date in Manila, not in UTC", () => {
  assert.equal(manilaToday(LATE_UTC), "2026-10-16");
  assert.equal(manilaToday(NOON_UTC), "2026-10-15");
});

test("days are counted on the Manila calendar", () => {
  assert.equal(daysUntilExpiry("2026-10-16", LATE_UTC), 0);
  assert.equal(daysUntilExpiry("2026-10-15", LATE_UTC), -1);
  assert.equal(daysUntilExpiry("2026-10-16", NOON_UTC), 1);
});

test("a licence is good through its expiry date", () => {
  assert.equal(expiryState("2026-10-15", NOON_UTC).state, "expiring"); // today
  assert.equal(expiryState("2026-10-14", NOON_UTC).state, "expired");
});

test("states: none, valid, expiring, expired", () => {
  assert.deepEqual(expiryState(null, NOON_UTC), { state: "none", daysLeft: null });
  assert.equal(expiryState("2027-10-15", NOON_UTC).state, "valid");
  assert.equal(expiryState("2026-12-14", NOON_UTC).state, "expiring"); // exactly 60 days
  assert.equal(expiryState("2026-12-15", NOON_UTC).state, "valid"); // 61
  assert.equal(expiryState("2026-01-01", NOON_UTC).state, "expired");
});

test("a Date or a timestamp string is reduced to its day", () => {
  assert.equal(dateOnly("2027-01-15"), "2027-01-15");
  assert.equal(dateOnly("2027-01-15T00:00:00.000Z"), "2027-01-15");
  assert.equal(dateOnly(new Date("2027-01-15T00:00:00Z")), "2027-01-15");
  assert.equal(dateOnly("garbage"), null);
  assert.equal(dateOnly(new Date("nope")), null);
  assert.equal(dateOnly(null), null);
});

test("reminders: only the most urgent threshold crossed is due", () => {
  assert.equal(dueReminder("2027-10-15", NOON_UTC), null);   // a year away
  assert.equal(dueReminder("2026-12-14", NOON_UTC), 60);     // 60 days
  assert.equal(dueReminder("2026-11-30", NOON_UTC), 60);     // 46 days: crossed 60 only
  assert.equal(dueReminder("2026-11-14", NOON_UTC), 30);     // 30 days
  assert.equal(dueReminder("2026-10-20", NOON_UTC), 7);      // 5 days: 7, not 60+30+14+7
  assert.equal(dueReminder("2026-10-16", NOON_UTC), 1);      // tomorrow
  assert.equal(dueReminder("2026-10-15", NOON_UTC), 1);      // today
});

test("an expiry is announced for two weeks and then left alone", () => {
  assert.equal(dueReminder("2026-10-14", NOON_UTC), 0);
  assert.equal(dueReminder("2026-10-01", NOON_UTC), 0);      // 14 days ago
  assert.equal(dueReminder("2026-09-30", NOON_UTC), null);   // 15 days ago
  assert.equal(dueReminder("2024-01-01", NOON_UTC), null);
});

test("no expiry, no reminder", () => {
  assert.equal(dueReminder(null, NOON_UTC), null);
});

test("how it reads", () => {
  assert.equal(describeExpiry(null), "No expiry recorded");
  assert.equal(describeExpiry(-5), "Expired 5 days ago");
  assert.equal(describeExpiry(-1), "Expired yesterday");
  assert.equal(describeExpiry(0), "Expires today");
  assert.equal(describeExpiry(1), "Expires tomorrow");
  assert.equal(describeExpiry(12), "Expires in 12 days");
});
