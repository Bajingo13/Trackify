import "../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeRealtimeScope,
  canReceiveRealtimeEvent,
  realtimeScopeMatches,
  RealtimeAuthorizationError,
} from "./hub.js";

function params(companyId, branchId) {
  const value = new URLSearchParams();
  if (companyId !== undefined) value.set("companyId", companyId);
  if (branchId !== undefined) value.set("branchId", branchId);
  return value;
}

function fakeRunner({
  activeUser = true,
  validScope = true,
  systemAdmin = false,
  access = true,
  tripRead = true,
  tracking = true,
} = {}) {
  const calls = [];
  return {
    calls,
    async execute(sql, values) {
      calls.push({ method: "execute", sql, values });
      if (sql.includes("FROM users")) return [activeUser ? [{ user_id: 9 }] : []];
      if (sql.includes("FROM branches") || sql.includes("FROM companies")) {
        return [validScope ? [{ branch_id: 22 }] : []];
      }
      if (sql.includes("FROM user_company_access")) {
        return [access ? [{ access_id: 1 }] : []];
      }
      throw new Error(`Unexpected execute: ${sql}`);
    },
    async query(sql, values) {
      calls.push({ method: "query", sql, values });
      if (sql.includes("p.permission_code IN")) {
        const permission = values.at(-1);
        const allowed = permission === "tracking.read" ? tracking : tripRead;
        return [allowed ? [{ allowed: 1 }] : []];
      }
      return [systemAdmin ? [{ allowed: 1 }] : []];
    },
  };
}

function deniedWith(code) {
  return (error) => error instanceof RealtimeAuthorizationError && error.code === code;
}

test("realtime rejects driver tokens and missing or malformed company scope", async () => {
  const runner = fakeRunner();
  await assert.rejects(
    authorizeRealtimeScope(
      { kind: "driver", driverId: 4, companyId: 1, branchId: 2 },
      params("1", "2"),
      runner
    ),
    deniedWith(4003)
  );
  await assert.rejects(
    authorizeRealtimeScope({ userId: 9, branchId: 2 }, params("1", "2"), runner),
    deniedWith(4002)
  );
  await assert.rejects(
    authorizeRealtimeScope(
      { userId: 9, companyId: 1, branchId: "not-an-id" },
      params("1", "2"),
      runner
    ),
    deniedWith(4002)
  );
});

test("realtime requires an active staff account and a valid active scope", async () => {
  await assert.rejects(
    authorizeRealtimeScope(
      { userId: 9, companyId: 1, branchId: 2 },
      params("1", "2"),
      fakeRunner({ activeUser: false })
    ),
    deniedWith(4003)
  );
  await assert.rejects(
    authorizeRealtimeScope(
      { userId: 9, companyId: 1, branchId: 2 },
      params("1", "2"),
      fakeRunner({ validScope: false })
    ),
    deniedWith(4003)
  );
});

test("branch realtime requires scoped access and at least one event permission", async () => {
  const allowed = await authorizeRealtimeScope(
    { userId: 9, companyId: 11, branchId: 22 },
    params("999", "998"),
    fakeRunner()
  );
  assert.deepEqual(allowed, {
    userId: 9,
    companyId: 11,
    branchId: 22,
    canReadTrips: true,
    canTrack: true,
  });

  await assert.rejects(
    authorizeRealtimeScope(
      { userId: 9, companyId: 11, branchId: 22 },
      params("11", "22"),
      fakeRunner({ access: false })
    ),
    deniedWith(4003)
  );
  await assert.rejects(
    authorizeRealtimeScope(
      { userId: 9, companyId: 11, branchId: 22 },
      params("11", "22"),
      fakeRunner({ tripRead: false, tracking: false })
    ),
    deniedWith(4003)
  );
});

test("realtime requires a concrete signed branch even for broad account access", async () => {
  await assert.rejects(
    authorizeRealtimeScope(
      { userId: 9, companyId: 11, branchId: null },
      params("11", "22"),
      fakeRunner()
    ),
    deniedWith(4002)
  );
});

test("a real system administrator may request any valid explicit company scope", async () => {
  const runner = fakeRunner({ systemAdmin: true, access: false, tracking: false });
  const scope = await authorizeRealtimeScope(
    { userId: 9, companyId: 33, branchId: 44 },
    params("999", "998"),
    runner
  );
  assert.deepEqual(scope, {
    userId: 9,
    companyId: 33,
    branchId: 44,
    canReadTrips: true,
    canTrack: true,
  });
  assert.equal(
    runner.calls.some((call) => call.sql.includes("user_company_access")),
    false,
    "the global wildcard does not depend on stale access rows"
  );
});

test("realtime fan-out is fail-closed across tenant and branch boundaries", () => {
  const branchClient = { companyId: 11, branchId: 22 };

  assert.equal(realtimeScopeMatches(branchClient, 11, 22), true);
  assert.equal(realtimeScopeMatches(branchClient, 11, 23), false);
  assert.equal(realtimeScopeMatches(branchClient, 12, 22), false);
  assert.equal(realtimeScopeMatches(branchClient, null, 22), false);
  assert.equal(realtimeScopeMatches(branchClient, 11, null), false);
});

test("location and operational events use separate permissions", () => {
  const dispatcher = { canReadTrips: true, canTrack: false };
  const tracker = { canReadTrips: false, canTrack: true };

  assert.equal(canReceiveRealtimeEvent(dispatcher, { type: "trip:status" }), true);
  assert.equal(canReceiveRealtimeEvent(dispatcher, { type: "trip:stop" }), true);
  assert.equal(canReceiveRealtimeEvent(dispatcher, { type: "trip:location" }), false);
  assert.equal(canReceiveRealtimeEvent(tracker, { type: "trip:location" }), true);
  assert.equal(canReceiveRealtimeEvent(tracker, { type: "trip:status" }), true);
  assert.equal(canReceiveRealtimeEvent(tracker, { type: "trip:stop" }), false);
  assert.equal(canReceiveRealtimeEvent(dispatcher, { type: "unknown" }), false);
});
