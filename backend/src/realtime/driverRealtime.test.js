import "../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
  issueDriverRealtimeTicket,
  issueRealtimeTicket,
  verifyDriverRealtimeTicket,
  verifyRealtimeTicket,
} from "./ticket.js";
import { authorizeDriverRealtime, authorizeRealtimeScope, RealtimeAuthorizationError } from "./hub.js";

/**
 * The Driver App's live socket. A driver ticket opens a line that carries only
 * that driver's own events; it can never pass as a staff ticket (which would
 * join a whole branch's operations stream), and a staff ticket cannot pass as
 * a driver's.
 */
const SECRET = "test-secret";

test("a driver ticket names the driver and company, and lasts a minute", () => {
  const t = issueDriverRealtimeTicket({ driverId: 7, companyId: 3 }, SECRET);
  assert.deepEqual(verifyDriverRealtimeTicket(t, SECRET), { kind: "driver", driverId: 7, companyId: 3 });
  const { exp, iat } = jwt.decode(t);
  assert.equal(exp - iat, 60);
});

test("a driver ticket is not a staff ticket, and a staff ticket is not a driver's", () => {
  const driverTicket = issueDriverRealtimeTicket({ driverId: 7, companyId: 3 }, SECRET);
  const staffTicket = issueRealtimeTicket({ userId: 9, companyId: 3, branchId: 2 }, SECRET);
  assert.throws(() => verifyRealtimeTicket(driverTicket, SECRET));
  assert.throws(() => verifyDriverRealtimeTicket(staffTicket, SECRET));
});

test("a driver's sign-in token cannot be used as a socket ticket", () => {
  const session = jwt.sign({ kind: "driver", driverId: 7, companyId: 3 }, SECRET, { expiresIn: "12h" });
  assert.throws(() => verifyDriverRealtimeTicket(session, SECRET));
});

test("the staff authoriser still refuses anything that says it is a driver", async () => {
  await assert.rejects(
    authorizeRealtimeScope({ kind: "driver", userId: 9, companyId: 3, branchId: 2 }, null, { execute: async () => [[]] }),
    RealtimeAuthorizationError,
  );
});

const runner = (found) => ({
  calls: [],
  async execute(sql, params) { this.calls.push({ sql, params }); return [found ? [{ driver_id: 7 }] : []]; },
});

test("a driver may hold a socket only while they could sign in", async () => {
  const ok = runner(true);
  assert.deepEqual(await authorizeDriverRealtime({ kind: "driver", driverId: 7, companyId: 3 }, ok), { driverId: 7, companyId: 3 });
  assert.match(ok.calls[0].sql, /status = 'active' AND app_enabled = 1/);
  assert.deepEqual(ok.calls[0].params, [7, 3]);

  // deactivated, app access withdrawn, or another company's id
  await assert.rejects(authorizeDriverRealtime({ kind: "driver", driverId: 7, companyId: 3 }, runner(false)), RealtimeAuthorizationError);
  await assert.rejects(authorizeDriverRealtime({ kind: "staff", driverId: 7, companyId: 3 }, runner(true)), RealtimeAuthorizationError);
});
