import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
  issueRealtimeTicket,
  verifyRealtimeTicket,
  REALTIME_TICKET_AUDIENCE,
  REALTIME_TICKET_ISSUER,
  REALTIME_TICKET_TTL_SECONDS,
} from "./ticket.js";

const TEST_SECRET = "realtime-ticket-test-secret-that-is-long-enough";
const scope = { userId: 9, companyId: 11, branchId: 22 };

test("realtime tickets are short-lived, purpose-bound, and normalize signed scope", () => {
  const token = issueRealtimeTicket(scope, TEST_SECRET);
  const decoded = jwt.decode(token);

  assert.equal(decoded.aud, REALTIME_TICKET_AUDIENCE);
  assert.equal(decoded.iss, REALTIME_TICKET_ISSUER);
  assert.equal(decoded.kind, "realtime_ticket");
  assert.equal(decoded.purpose, "realtime.subscribe");
  assert.equal(decoded.scope, "operations.events");
  assert.equal(decoded.sub, "9");
  assert.equal(decoded.companyId, 11);
  assert.equal(decoded.branchId, 22);
  assert.equal(typeof decoded.jti, "string");
  assert.ok(decoded.jti.length > 0);
  assert.equal(decoded.exp - decoded.iat, REALTIME_TICKET_TTL_SECONDS);
  assert.deepEqual(verifyRealtimeTicket(token, TEST_SECRET), scope);
});

test("realtime ticket issuance rejects incomplete or non-positive scope", () => {
  for (const invalid of [
    { userId: 0, companyId: 11, branchId: 22 },
    { userId: 9, companyId: -1, branchId: 22 },
    { userId: 9, companyId: 11, branchId: null },
  ]) {
    assert.throws(() => issueRealtimeTicket(invalid, TEST_SECRET), /positive integer/);
  }
});

test("ordinary sessions and overlong or wrong-purpose tokens cannot become socket tickets", () => {
  const common = {
    algorithm: "HS256",
    audience: REALTIME_TICKET_AUDIENCE,
    issuer: REALTIME_TICKET_ISSUER,
    subject: "9",
    jwtid: "test-ticket-id",
  };
  const staff = jwt.sign({ userId: 9 }, TEST_SECRET, { expiresIn: "8h" });
  const driver = jwt.sign({ kind: "driver", driverId: 4 }, TEST_SECRET, { expiresIn: "12h" });
  const wrongPurpose = jwt.sign(
    {
      kind: "realtime_ticket",
      purpose: "something.else",
      scope: "operations.events",
      companyId: 11,
      branchId: 22,
    },
    TEST_SECRET,
    { ...common, expiresIn: 60 }
  );
  const overlong = jwt.sign(
    {
      kind: "realtime_ticket",
      purpose: "realtime.subscribe",
      scope: "operations.events",
      companyId: 11,
      branchId: 22,
    },
    TEST_SECRET,
    { ...common, expiresIn: 120 }
  );

  for (const token of [staff, driver, wrongPurpose, overlong]) {
    assert.throws(() => verifyRealtimeTicket(token, TEST_SECRET));
  }
});
