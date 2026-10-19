import crypto from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import db from "../../config/db.js";
import { disconnectDriver, disconnectDriverDevices, publish, publishToDriver } from "../../realtime/hub.js";
import { notifyDriver } from "../support/push.service.js";

/**
 * One trusted phone per driver.
 *
 * A PIN alone used to open a driver's account on any phone. Now each phone
 * makes a random key for itself the first time the app opens (driverApi.js,
 * deviceKey) and sends it on every request. A driver has at most one `active`
 * phone. A sign-in from any other phone is held as `pending` and sees nothing
 * until the driver proves it is them:
 *
 *   • with one of their recovery codes — eight single-use codes handed out
 *     when their first phone was set up and kept on paper, so a phone that
 *     breaks on the road can be replaced at any hour without the office; or
 *   • by the office approving it (driver.device.manage), after calling them.
 *
 * Whichever way, the new phone becomes the active one and the old one is
 * revoked: its token stops working on its next request and its live socket and
 * notifications end with it.
 *
 * Only hashes are stored. The device key never leaves the phone except in a
 * request header, and the plain codes exist on the driver's paper.
 */

export const CODE_COUNT = 8;
export const MAX_VERIFY_FAILURES = 10;
export const LOW_CODES = 2;
// As long as the office's bell lists the request: a driver without codes may
// wait a while for someone to call them back. The token is bound to the phone.
const PENDING_TTL = "24h";
// Crockford-style: no 0/O, 1/I/L, so a code read over the phone is not misheard.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const DEVICE_KEY = /^[A-Za-z0-9_-]{32,128}$/;

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export const deviceKeyHash = (key) => sha256(String(key));
export const isDeviceKey = (key) => typeof key === "string" && DEVICE_KEY.test(key);

/** As written down — upper case, no spaces or dashes — so "abcde-fghjk" and "ABCDEFGHJK" are the same code. */
export const normaliseCode = (code) => String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const codeHash = (code) => sha256(normaliseCode(code));

/** Ten characters from a 31-letter alphabet: about 50 bits, shown as XXXXX-XXXXX. */
export function generateCode() {
  let out = "";
  for (let i = 0; i < 10; i += 1) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function signDriverToken({ driverId, companyId, deviceId }) {
  return jwt.sign(
    { kind: "driver", driverId, companyId, deviceId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.DRIVER_JWT_EXPIRES_IN || "12h" }
  );
}

/** Proves only "this phone gave the right PIN a few minutes ago". It opens nothing but the verify and status routes. */
export function signPendingToken({ driverId, companyId, deviceId }) {
  return jwt.sign(
    { kind: "driver-device-pending", driverId, companyId, deviceId },
    process.env.JWT_SECRET,
    { expiresIn: PENDING_TTL }
  );
}

export function readPendingToken(token) {
  try {
    const payload = jwt.verify(String(token || ""), process.env.JWT_SECRET);
    if (payload.kind !== "driver-device-pending" || !payload.driverId || !payload.deviceId) return null;
    return payload;
  } catch {
    return null;
  }
}

const shortAgent = (ua) => String(ua || "").slice(0, 255) || null;
const shortIp = (ip) => String(ip || "").slice(0, 64) || null;

/** Replace the driver's codes with a new set. Returns the plain codes — the only time they exist outside paper. */
export async function issueRecoveryCodes(runner, { companyId, driverId }) {
  await runner.execute(
    `UPDATE driver_recovery_codes SET revoked_at = NOW(3)
      WHERE driver_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
    [driverId]
  );
  const codes = Array.from({ length: CODE_COUNT }, generateCode);
  const rows = codes.map(() => "(?, ?, ?)").join(", ");
  await runner.execute(
    `INSERT INTO driver_recovery_codes (company_id, driver_id, code_hash) VALUES ${rows}`,
    codes.flatMap((c) => [companyId, driverId, codeHash(c)])
  );
  return codes;
}

export async function codesLeft(runner, driverId) {
  const [[row]] = await runner.execute(
    `SELECT COUNT(*) AS n FROM driver_recovery_codes
      WHERE driver_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
    [driverId]
  );
  return Number(row?.n || 0);
}

/**
 * Make `deviceId` the driver's one active phone. Every other phone that was
 * active is revoked and its notification addresses dropped. Addresses from
 * before phones were recorded (no device_id) are adopted by the first phone
 * set up — almost always the phone they came from — and dropped on a move to
 * a new phone, since they belong to the one being replaced.
 * Runs inside the caller's transaction. Returns the ids revoked.
 */
async function activate(conn, { driverId, deviceId, via, approvedBy = null }) {
  const [others] = await conn.execute(
    `SELECT device_id FROM driver_devices WHERE driver_id = ? AND status = 'active' AND device_id <> ?`,
    [driverId, deviceId]
  );
  const revoked = others.map((r) => r.device_id);
  if (revoked.length) {
    await conn.execute(
      `UPDATE driver_devices SET status = 'revoked', revoked_at = NOW(3), revoked_reason = 'replaced by a new phone'
        WHERE driver_id = ? AND status = 'active' AND device_id <> ?`,
      [driverId, deviceId]
    );
  }
  await conn.execute(
    `UPDATE driver_devices
        SET status = 'active', approved_via = ?, approved_by_user_id = ?, approved_at = NOW(3),
            revoked_at = NULL, revoked_reason = NULL
      WHERE device_id = ? AND driver_id = ?`,
    [via, approvedBy, deviceId, driverId]
  );
  await conn.execute("UPDATE drivers SET device_enroll_open = 0 WHERE driver_id = ?", [driverId]);
  if (via === "first_device") {
    await conn.execute(
      "UPDATE driver_push_subscriptions SET device_id = ? WHERE driver_id = ? AND device_id IS NULL",
      [deviceId, driverId]
    );
  } else {
    await conn.execute(
      "DELETE FROM driver_push_subscriptions WHERE driver_id = ? AND (device_id IS NULL OR device_id <> ?)",
      [driverId, deviceId]
    );
  }
  return revoked;
}

async function withTransaction(fn) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * The PIN was right. Decide what this phone may do:
 *
 *   enrolled — set-up is open (the driver's first phone, or the office reset
 *              them): this one becomes trusted, and recovery codes are issued.
 *   trusted  — this is the active phone.
 *   pending  — not the trusted phone, or no phone is trusted but set-up is
 *              closed (the office signed the last one out): it waits for a
 *              code or the office.
 *   locked   — as pending, but too many wrong codes; only the office now.
 *   blocked  — the office signed this phone out. The PIN cannot bring it back.
 */
export function resolveSignIn(args) {
  return resolver(args);
}

// A seam for tests of the sign-in screen, which stub single queries rather than a transaction.
let resolver = resolveSignInTx;
export function useSignInResolver(fn) {
  const before = resolver;
  resolver = fn || resolveSignInTx;
  return () => { resolver = before; };
}

async function resolveSignInTx({ driver, deviceKey, userAgent, ip }) {
  const keyHash = deviceKeyHash(deviceKey);
  return withTransaction(async (conn) => {
    // Serialises two phones signing in at the same moment: one of them is first.
    const [[state]] = await conn.execute(
      "SELECT device_verify_locked_at, device_enroll_open FROM drivers WHERE driver_id = ? FOR UPDATE",
      [driver.driver_id]
    );
    const [[active]] = await conn.execute(
      "SELECT device_id, key_hash FROM driver_devices WHERE driver_id = ? AND status = 'active' LIMIT 1",
      [driver.driver_id]
    );

    if (active && active.key_hash === keyHash) {
      // The driver, on their own phone: wrong codes from earlier attempts no
      // longer count against them (a lock, once set, still waits for the office).
      await conn.execute(
        "UPDATE driver_devices SET last_seen_at = NOW(3), last_ip = ?, user_agent = ? WHERE device_id = ?",
        [shortIp(ip), shortAgent(userAgent), active.device_id]
      );
      if (!state?.device_verify_locked_at) {
        await conn.execute("UPDATE drivers SET device_verify_failures = 0 WHERE driver_id = ?", [driver.driver_id]);
      }
      return { outcome: "trusted", deviceId: active.device_id };
    }

    // This phone, as the database knows it. A phone the office signed out stays out.
    const [[known]] = await conn.execute(
      "SELECT device_id, status FROM driver_devices WHERE driver_id = ? AND key_hash = ? LIMIT 1",
      [driver.driver_id, keyHash]
    );
    if (known?.status === "blocked") return { outcome: "blocked", deviceId: known.device_id };

    await conn.execute(
      `INSERT INTO driver_devices (company_id, driver_id, key_hash, user_agent, last_ip, last_seen_at, status)
       VALUES (?, ?, ?, ?, ?, NOW(3), 'pending')
       ON DUPLICATE KEY UPDATE user_agent = VALUES(user_agent), last_ip = VALUES(last_ip), last_seen_at = NOW(3),
         status = 'pending', revoked_at = NULL, revoked_reason = NULL`,
      [driver.company_id, driver.driver_id, keyHash, shortAgent(userAgent), shortIp(ip)]
    );
    const [[device]] = await conn.execute(
      "SELECT device_id FROM driver_devices WHERE driver_id = ? AND key_hash = ? LIMIT 1",
      [driver.driver_id, keyHash]
    );

    if (!active && state?.device_enroll_open) {
      await activate(conn, { driverId: driver.driver_id, deviceId: device.device_id, via: "first_device" });
      const recoveryCodes = await issueRecoveryCodes(conn, { companyId: driver.company_id, driverId: driver.driver_id });
      return { outcome: "enrolled", deviceId: device.device_id, recoveryCodes };
    }

    if (state?.device_verify_locked_at) return { outcome: "locked", deviceId: device.device_id };
    return { outcome: "pending", deviceId: device.device_id };
  });
}

/** Tell the trusted phone and the office that another phone is asking in. Best effort; never throws. */
export async function announcePending({ driver, deviceId }) {
  try {
    const name = `${driver.first_name || ""} ${driver.last_name || ""}`.trim();
    const warning = {
      type: "device:pending",
      deviceId,
      message: "Your account was just signed in on another phone. If this wasn't you, call your office now.",
    };
    publishToDriver(driver.company_id, driver.driver_id, warning);
    await notifyDriver({
      companyId: driver.company_id,
      driverId: driver.driver_id,
      title: "New phone sign-in",
      body: "Someone signed in to your account on another phone. If this wasn't you, call your office.",
      tag: "device-pending",
    });
    if (driver.home_branch_id) {
      publish(driver.company_id, driver.home_branch_id, {
        type: "driver:device_pending",
        driverId: driver.driver_id,
        deviceId,
        driverName: name,
        employeeNo: driver.employee_no,
      });
    }
  } catch (err) {
    console.error(`[devices] Could not announce a new phone for driver ${driver.driver_id}: ${err.message}`);
  }
}

/** Close the live sockets of the phones that lost access, and only theirs. Called after the transaction commits. */
function cutOff(companyId, driverId, revokedIds) {
  if (revokedIds.length) disconnectDriverDevices(companyId, driverId, revokedIds);
}

/**
 * The pending token says which phone it was issued to; the request must come
 * from that phone. A pending token copied elsewhere cannot finish a sign-in.
 */
async function pendingDeviceMatches(runner, pending, deviceKey) {
  if (!isDeviceKey(deviceKey)) return false;
  const [[row]] = await runner.execute(
    "SELECT 1 AS ok FROM driver_devices WHERE device_id = ? AND driver_id = ? AND key_hash = ? LIMIT 1",
    [pending.deviceId, pending.driverId, deviceKeyHash(deviceKey)]
  );
  return Boolean(row);
}

/**
 * The pending phone enters a recovery code. Returns
 *   { token, deviceId, codesLeft }                       — it is the active phone now
 *   { status, error, wrongCode?, locked?, attemptsLeft? } — it is not
 */
export async function verifyWithCode({ pending, code, deviceKey }) {
  const { driverId, deviceId, companyId } = pending;
  if (!(await pendingDeviceMatches(db, pending, deviceKey))) {
    return { status: 401, error: "Sign in again on this phone." };
  }
  const result = await withTransaction(async (conn) => {
    const [[drv]] = await conn.execute(
      `SELECT driver_id, company_id, device_verify_failures, device_verify_locked_at
         FROM drivers WHERE driver_id = ? AND company_id = ? AND status = 'active' AND app_enabled = 1 FOR UPDATE`,
      [driverId, companyId]
    );
    if (!drv) return { status: 401, error: "This account can't sign in. Ask your office." };
    if (drv.device_verify_locked_at) {
      return { status: 423, error: "Too many wrong codes. Call your office to unlock your account." };
    }
    const [[device]] = await conn.execute(
      "SELECT status FROM driver_devices WHERE device_id = ? AND driver_id = ? LIMIT 1",
      [deviceId, driverId]
    );
    if (!device || device.status !== "pending") {
      return { status: 409, error: "This sign-in is no longer waiting. Sign in again." };
    }

    const normalised = normaliseCode(code);
    const [[match]] = normalised.length === 10
      ? await conn.execute(
        `SELECT code_id FROM driver_recovery_codes
          WHERE driver_id = ? AND code_hash = ? AND used_at IS NULL AND revoked_at IS NULL LIMIT 1`,
        [driverId, codeHash(normalised)]
      )
      : [[]];

    if (!match) {
      const failures = Number(drv.device_verify_failures || 0) + 1;
      const lock = failures >= MAX_VERIFY_FAILURES;
      await conn.execute(
        `UPDATE drivers SET device_verify_failures = ?, device_verify_locked_at = ${lock ? "NOW(3)" : "NULL"} WHERE driver_id = ?`,
        [failures, driverId]
      );
      if (lock) {
        return { status: 423, error: "Too many wrong codes. Call your office to unlock your account.", wrongCode: true, locked: true };
      }
      return {
        status: 401, error: "That code isn't right, or it has been used.", wrongCode: true,
        attemptsLeft: MAX_VERIFY_FAILURES - failures,
      };
    }

    await conn.execute(
      "UPDATE driver_recovery_codes SET used_at = NOW(3), used_device_id = ? WHERE code_id = ?",
      [deviceId, match.code_id]
    );
    await conn.execute("UPDATE drivers SET device_verify_failures = 0 WHERE driver_id = ?", [driverId]);
    const revoked = await activate(conn, { driverId, deviceId, via: "recovery_code" });
    return { ok: true, revoked, codesLeft: await codesLeft(conn, driverId) };
  });

  if (!result.ok) return result;
  cutOff(companyId, driverId, result.revoked);
  return { token: signDriverToken({ driverId, companyId, deviceId }), deviceId, codesLeft: result.codesLeft };
}

/** The waiting phone asks whether the office has decided. */
export async function pendingStatus({ pending, deviceKey }) {
  const { driverId, deviceId, companyId } = pending;
  // A session is only handed to the phone that asked for it.
  if (!(await pendingDeviceMatches(db, pending, deviceKey))) return { status: "refused" };
  const [[device]] = await db.execute(
    `SELECT dd.status FROM driver_devices dd
       JOIN drivers d ON d.driver_id = dd.driver_id AND d.status = 'active' AND d.app_enabled = 1
      WHERE dd.device_id = ? AND dd.driver_id = ? AND dd.company_id = ? LIMIT 1`,
    [deviceId, driverId, companyId]
  );
  if (!device) return { status: "refused" };
  if (device.status === "active") {
    return { status: "approved", token: signDriverToken({ driverId, companyId, deviceId }), codesLeft: await codesLeft(db, driverId) };
  }
  if (device.status !== "pending") return { status: "refused" };
  return { status: "waiting" };
}

/** The active phone asks for a new set of codes. The PIN is asked again: a phone left unlocked is not enough. */
export async function regenerateForDriver({ driver, pin }) {
  const [[row]] = await db.execute("SELECT pin_hash FROM drivers WHERE driver_id = ? LIMIT 1", [driver.driverId]);
  if (!row?.pin_hash || !(await bcrypt.compare(String(pin || ""), row.pin_hash))) {
    // 403, not 401: the session is fine, and the app reads a 401 as "signed out".
    return { status: 403, error: "That PIN isn't right." };
  }
  const codes = await withTransaction((conn) =>
    issueRecoveryCodes(conn, { companyId: driver.companyId, driverId: driver.driverId })
  );
  return { recoveryCodes: codes };
}

/* ---------------------------------------------------------------- */
/* Office                                                           */
/* ---------------------------------------------------------------- */

async function driverInCompany(runner, companyId, driverId) {
  const [[drv]] = await runner.execute(
    `SELECT driver_id, company_id, device_verify_failures, device_verify_locked_at
       FROM drivers WHERE driver_id = ? AND company_id = ? LIMIT 1`,
    [driverId, companyId]
  );
  return drv || null;
}

export async function listForOffice({ companyId, driverId }) {
  const drv = await driverInCompany(db, companyId, driverId);
  if (!drv) return null;
  const [devices] = await db.execute(
    `SELECT dd.device_id AS id, dd.status, dd.user_agent AS userAgent, dd.approved_via AS approvedVia,
            dd.created_at AS createdAt, dd.approved_at AS approvedAt, dd.last_seen_at AS lastSeenAt,
            dd.revoked_at AS revokedAt, dd.revoked_reason AS revokedReason,
            CONCAT_WS(' ', u.first_name, u.last_name) AS approvedBy
       FROM driver_devices dd
       LEFT JOIN users u ON u.user_id = dd.approved_by_user_id
      WHERE dd.driver_id = ? AND dd.company_id = ?
      ORDER BY FIELD(dd.status, 'pending', 'active', 'revoked', 'blocked'), dd.last_seen_at DESC
      LIMIT 20`,
    [driverId, companyId]
  );
  return {
    devices,
    codesLeft: await codesLeft(db, driverId),
    locked: Boolean(drv.device_verify_locked_at),
    failures: Number(drv.device_verify_failures || 0),
  };
}

/**
 * Phones waiting for the office across the company, for the bell. A request
 * nobody has touched for a day is left off: the driver has long since used a
 * code, called, or given up, and it is still on the driver's page.
 */
export async function pendingForOffice({ companyId }) {
  const [rows] = await db.execute(
    `SELECT dd.device_id AS deviceId, dd.driver_id AS driverId, dd.last_seen_at AS askedAt,
            d.employee_no AS employeeNo, CONCAT_WS(' ', d.first_name, d.last_name) AS driverName,
            (d.device_verify_locked_at IS NOT NULL) AS locked
       FROM driver_devices dd
       JOIN drivers d ON d.driver_id = dd.driver_id AND d.status = 'active'
      WHERE dd.company_id = ? AND dd.status = 'pending' AND dd.last_seen_at > NOW(3) - INTERVAL 1 DAY
      ORDER BY dd.last_seen_at DESC
      LIMIT 20`,
    [companyId]
  );
  return rows.map((r) => ({ ...r, locked: Boolean(r.locked) }));
}

/** The office approves a waiting phone, having called the driver. */
export async function approveByOffice({ companyId, driverId, deviceId, userId }) {
  const result = await withTransaction(async (conn) => {
    const [[drv]] = await conn.execute(
      "SELECT driver_id FROM drivers WHERE driver_id = ? AND company_id = ? FOR UPDATE",
      [driverId, companyId]
    );
    if (!drv) return { status: 404, error: "Driver not found." };
    const [[device]] = await conn.execute(
      "SELECT status FROM driver_devices WHERE device_id = ? AND driver_id = ? LIMIT 1",
      [deviceId, driverId]
    );
    if (!device) return { status: 404, error: "Phone not found." };
    if (device.status !== "pending") return { status: 409, error: "That phone is not waiting for approval." };
    const revoked = await activate(conn, { driverId, deviceId, via: "office", approvedBy: userId });
    // The office has spoken to the driver: a lock from wrong codes is over too.
    await conn.execute(
      "UPDATE drivers SET device_verify_failures = 0, device_verify_locked_at = NULL WHERE driver_id = ?",
      [driverId]
    );
    return { ok: true, revoked };
  });
  if (result.ok) cutOff(companyId, driverId, result.revoked);
  return result;
}

/**
 * A phone is lost or stolen, or a waiting one is refused: it is blocked and
 * signed out on its next request. The PIN alone never brings it back, and with
 * no trusted phone left the driver's next phone still needs a recovery code or
 * the office — set-up stays closed (see resolveSignIn).
 */
export async function revokeByOffice({ companyId, driverId, deviceId }) {
  const [res] = await db.execute(
    `UPDATE driver_devices SET status = 'blocked', revoked_at = NOW(3), revoked_reason = 'signed out by the office'
      WHERE device_id = ? AND driver_id = ? AND company_id = ? AND status <> 'blocked'`,
    [deviceId, driverId, companyId]
  );
  if (!res.affectedRows) return { status: 404, error: "Phone not found, or already signed out." };
  await db.execute("DELETE FROM driver_push_subscriptions WHERE device_id = ?", [deviceId]);
  disconnectDriverDevices(companyId, driverId, [deviceId]);
  return { ok: true };
}

/**
 * Start again: every phone signed out, every code cancelled, the lock lifted,
 * and set-up opened, so the next phone the driver signs in on becomes the
 * trusted one and is given codes. A phone the office blocked stays blocked.
 */
export async function resetByOffice({ companyId, driverId }) {
  const result = await withTransaction(async (conn) => {
    const drv = await driverInCompany(conn, companyId, driverId);
    if (!drv) return { status: 404, error: "Driver not found." };
    await conn.execute(
      `UPDATE driver_devices SET status = 'revoked', revoked_at = NOW(3), revoked_reason = 'reset by the office'
        WHERE driver_id = ? AND status IN ('pending', 'active')`,
      [driverId]
    );
    await conn.execute(
      "UPDATE driver_recovery_codes SET revoked_at = NOW(3) WHERE driver_id = ? AND used_at IS NULL AND revoked_at IS NULL",
      [driverId]
    );
    await conn.execute(
      "UPDATE drivers SET device_verify_failures = 0, device_verify_locked_at = NULL, device_enroll_open = 1 WHERE driver_id = ?",
      [driverId]
    );
    await conn.execute("DELETE FROM driver_push_subscriptions WHERE driver_id = ?", [driverId]);
    return { ok: true };
  });
  if (result.ok) disconnectDriver(companyId, driverId);
  return result;
}

/** New codes made by the office, to read to the driver over the phone. */
export async function codesByOffice({ companyId, driverId }) {
  return withTransaction(async (conn) => {
    const drv = await driverInCompany(conn, companyId, driverId);
    if (!drv) return { status: 404, error: "Driver not found." };
    return { recoveryCodes: await issueRecoveryCodes(conn, { companyId, driverId }) };
  });
}
