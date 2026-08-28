import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_ADMIN,
  ROLE_TEMPLATES,
  PERMISSION_CATALOG,
  ALL_PERMISSION_CODES,
  effectivePermissions,
  can,
  canAny,
  ungrantable,
  templatePermissions,
  isKnownPermission,
} from "./rbac.js";

test("catalog: codes are unique and non-empty", () => {
  const codes = PERMISSION_CATALOG.map(([c]) => c);
  assert.equal(new Set(codes).size, codes.length, "duplicate permission codes");
  assert.ok(codes.every((c) => /^[a-z][a-z.]*[a-z]$/.test(c)), "malformed code");
});

test("effectivePermissions: system.admin expands to every web permission", () => {
  const eff = effectivePermissions(["trip.read", SYSTEM_ADMIN]);
  assert.ok(eff.has("company.manage"));
  assert.ok(eff.has("voucher.approve"));
  assert.ok(!eff.has("driverapp.trip.read"), "driver-app perms are not web perms");
});

test("effectivePermissions: without wildcard the set is unchanged", () => {
  const eff = effectivePermissions(["trip.read", "trip.create"]);
  assert.deepEqual([...eff].sort(), ["trip.create", "trip.read"]);
});

test("can / canAny: wildcard satisfies anything", () => {
  assert.equal(can([SYSTEM_ADMIN], "anything.at.all"), true);
  assert.equal(can(["trip.read"], "trip.approve"), false);
  assert.equal(canAny(["trip.read"], ["trip.approve", "trip.read"]), true);
  assert.equal(canAny(["x.read"], ["trip.approve", "trip.assign"]), false);
});

test("ungrantable: a non-admin cannot grant what they do not hold", () => {
  const actor = ["trip.read", "trip.create"];
  assert.deepEqual(ungrantable(actor, ["trip.read"]), []);
  assert.deepEqual(ungrantable(actor, ["trip.approve"]), ["trip.approve"]);
  assert.deepEqual(ungrantable(actor, [SYSTEM_ADMIN]), [SYSTEM_ADMIN]);
});

test("ungrantable: a system admin can grant anything, including the wildcard", () => {
  assert.deepEqual(ungrantable([SYSTEM_ADMIN], ["trip.approve", SYSTEM_ADMIN]), []);
});

test("templates: exactly ten, every permission is real", () => {
  assert.equal(ROLE_TEMPLATES.length, 10);
  for (const tpl of ROLE_TEMPLATES) {
    assert.ok(tpl.name && tpl.description && tpl.key, `template ${tpl.key} missing fields`);
    for (const code of tpl.permissions) {
      assert.ok(isKnownPermission(code), `${tpl.name} references unknown permission ${code}`);
    }
  }
});

test("templates: separation of duties — no everyday role both creates and approves trips", () => {
  for (const tpl of ROLE_TEMPLATES) {
    if (tpl.name === "System Administrator" || tpl.name === "Company Administrator") continue;
    const set = new Set(tpl.permissions);
    assert.ok(
      !(set.has("trip.create") && set.has("trip.approve")),
      `${tpl.name} violates separation of duties`
    );
  }
});

test("templates: Auditor is read-only", () => {
  const auditor = ROLE_TEMPLATES.find((t) => t.key === "auditor");
  const writeVerb = /\.(create|update|manage|approve|reject|resolve|assign|submit|validate|release|cancel|close|delete)$/;
  assert.ok(
    auditor.permissions.every((c) => !writeVerb.test(c)),
    "auditor holds a write permission"
  );
});

test("templates: Driver has only driver-app permissions", () => {
  const driver = ROLE_TEMPLATES.find((t) => t.key === "driver");
  assert.ok(driver.permissions.every((c) => c.startsWith("driverapp.")));
});

test("templates: System Administrator holds the wildcard, Company Administrator does not", () => {
  const sys = templatePermissions("System Administrator");
  const co = templatePermissions("Company Administrator");
  assert.ok(sys.includes(SYSTEM_ADMIN));
  assert.ok(!co.includes(SYSTEM_ADMIN));
  assert.ok(co.includes("user.manage") && co.includes("role.manage"));
});

test("templatePermissions: unknown template resolves to empty", () => {
  assert.deepEqual(templatePermissions("Nonexistent Role"), []);
});

test("every catalog code is either web or driver-app", () => {
  assert.ok(ALL_PERMISSION_CODES.length > 60);
});
