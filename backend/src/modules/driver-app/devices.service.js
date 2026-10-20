import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import db from "../../config/db.js";
import { disconnectDriver, disconnectDriverDevices, publish, publishToDriver } from "../../realtime/hub.js";
import { notifyDriver } from "../support/push.service.js";
import { sendDriverMail, useDriverMailer } from "../../shared/driverMail.js";
import { driverDeviceCodeEmail } from "../../shared/driverDevice.email.js";

/**
 * One trusted phone per driver.
 *
 * Each phone makes a random key for itself the first time the app opens
 * (driverApi.js, deviceKey) and sends it on every request. A driver has at most
 * one `active` phone. A sign-in from a phone that is not it — including the
 * very first sign-in on a new account — is held as `pending` and sees nothing
 * until the driver proves it is them:
 *
 *   • with a one-time code emailed to the driver's registered address the
 *     moment the phone signs in. Six digits, single use, valid for
 *     CODE_TTL_MINUTES, and bound to the phone it was sent for; or
 *   • by the office approving it (driver.device.manage), after calling them —
 *     for a driver with no email on file, no access to it, or locked out.
 *
 * Whichever way, the new phone becomes the active one and the old one is
 * revoked: its token stops working on its next request and its live socket and
 * notifications end with it.
 *
 * Only hashes are stored. The device key never leaves the phone except in a
 * request header, and a plain code exists only in the driver's inbox.
 */

export const MAX_VERIFY_FAILURES = 10;
/** Wrong tries one code takes before it is cancelled and a new one is needed. */
export const MAX_CODE_ATTEMPTS = 5;
export const CODE_TTL_MINUTES = 10;
/** A code is not sent again within this long of the last; signing in twice reuses it. */
export const RESEND_COOLDOWN_SECONDS = 60;
/** Codes one driver may be sent in an hour, across all their phones. */
export const MAX_CODES_PER_HOUR = 5;
// As long as the office's bell lists a request: a driver waiting on the office
// may wait a while for someone to call them back. The token is bound to the phone.
const PENDING_TTL = "24h";
const DEVICE_KEY = /^[A-Za-z0-9_-]{32,128}$/;

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export const deviceKeyHash = (key) => sha256(String(key));
export const isDeviceKey = (key) => typeof key === "string" && DEVICE_KEY.test(key);

/** Digits only, so "482 913" and "482-913" are the same code. */
export const normaliseCode = (code) => String(code || "").replace(/\D/g, "");
/** Bound to the phone: a code sent for one phone does nothing on another. */
const codeHash = (deviceId, code) => sha256(`${deviceId}:${normaliseCode(code)}`);
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Six random digits. */
export const generateCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

/** "ju•••••@gmail.com": enough for a driver to know which inbox, not enough to give an address away. */
export function maskEmail(email) {
  const [user, domain] = String(email || "").split("@");
  if (!user || !domain) return "";
  return `${user.slice(0, Math.min(2, user.length - 1) || 1)}${"•".repeat(Math.max(3, user.length - 2))}@${domain}`;
}

/** "Android 14 · Chrome" from a user agent, for the email. */
export function phoneLabel(ua) {
  const s = String(ua || "");
  const android = s.match(/Android [\d.]+/);
  const ios = s.match(/iPhone OS [\d_]+/);
  const os = android?.[0] || (ios ? ios[0].replace("iPhone OS", "iOS").replace(/_/g, ".") : null);
  const app = /wv\)/.test(s) ? "Trackify Driver app" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : null;
  return [os, app].filter(Boolean).join(" · ");
}

export function signDriverToken({ driverId, companyId, deviceId }) {
  return jwt.sign(
    { kind: "driver", driverId, companyId, deviceId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.DRIVER_JWT_EXPIRES_IN || "12h" }
  );
}

/** Proves only "this phone gave the right PIN". It opens nothing but the verify, resend, ask-office and status routes. */
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
            revoked_at = NULL, revoked_reason = NULL, office_requested_at = NULL
      WHERE device_id = ? AND driver_id = ?`,
    [via, approvedBy, deviceId, driverId]
  );
  await conn.execute("UPDATE drivers SET device_enroll_open = 0 WHERE driver_id = ?", [driverId]);
  // No code sent for this driver is any use any more.
  await conn.execute(
    "UPDATE driver_device_email_codes SET revoked_at = NOW(3) WHERE driver_id = ? AND used_at IS NULL AND revoked_at IS NULL",
    [driverId]
  );
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
 *   trusted  — this is the active phone.
 *   enrolled — set-up is open and the driver has no email to send a code to
 *              (a driver from before emails were kept): this one becomes
 *              trusted on the PIN, as it always did.
 *   pending  — any other phone, or a new account's first phone: it waits for
 *              the emailed code or the office. `firstPhone` says the latter,
 *              `email` where the code goes (null: office only).
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
      "SELECT device_verify_locked_at, device_enroll_open, email FROM drivers WHERE driver_id = ? FOR UPDATE",
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

    // A fresh sign-in starts a fresh request: the office is asked again only if the driver asks.
    await conn.execute(
      `INSERT INTO driver_devices (company_id, driver_id, key_hash, user_agent, last_ip, last_seen_at, status)
       VALUES (?, ?, ?, ?, ?, NOW(3), 'pending')
       ON DUPLICATE KEY UPDATE user_agent = VALUES(user_agent), last_ip = VALUES(last_ip), last_seen_at = NOW(3),
         status = 'pending', revoked_at = NULL, revoked_reason = NULL, office_requested_at = NULL`,
      [driver.company_id, driver.driver_id, keyHash, shortAgent(userAgent), shortIp(ip)]
    );
    const [[device]] = await conn.execute(
      "SELECT device_id FROM driver_devices WHERE driver_id = ? AND key_hash = ? LIMIT 1",
      [driver.driver_id, keyHash]
    );

    const email = state?.email ? String(state.email).trim() : null;
    const firstPhone = !active && Boolean(state?.device_enroll_open);

    if (firstPhone && !email) {
      await activate(conn, { driverId: driver.driver_id, deviceId: device.device_id, via: "first_device" });
      return { outcome: "enrolled", deviceId: device.device_id };
    }

    if (state?.device_verify_locked_at) return { outcome: "locked", deviceId: device.device_id, firstPhone, email };
    return { outcome: "pending", deviceId: device.device_id, firstPhone, email, hadPhone: Boolean(active) };
  });
}

/* ---------------------------------------------------------------- */
/* The emailed code                                                 */
/* ---------------------------------------------------------------- */

// The tests' name for the shared driver-mail seam (shared/driverMail.js).
export const useCodeMailer = useDriverMailer;

/**
 * Email a new code for this phone, cancelling any earlier one. Signing in again
 * within RESEND_COOLDOWN_SECONDS reuses the code already sent rather than
 * flooding the inbox; an explicit resend in that window is refused with how
 * long to wait. Returns { sent: true } or { sent: false, status, error, retryAfter? }.
 */
export async function sendDeviceCode({ driver, deviceId, email, firstPhone, userAgent, resend = false }) {
  const driverId = driver.driver_id;
  const [[last]] = await db.execute(
    `SELECT TIMESTAMPDIFF(SECOND, created_at, NOW(3)) AS age, (expires_at > NOW(3)) AS live
       FROM driver_device_email_codes
      WHERE device_id = ? AND used_at IS NULL AND revoked_at IS NULL
      ORDER BY code_id DESC LIMIT 1`,
    [deviceId]
  );
  if (last && last.live && Number(last.age) < RESEND_COOLDOWN_SECONDS) {
    if (!resend) return { sent: true, reused: true };
    const retryAfter = RESEND_COOLDOWN_SECONDS - Number(last.age);
    return { sent: false, status: 429, error: `Wait ${retryAfter} seconds before asking for another code.`, retryAfter };
  }

  const [[hour]] = await db.execute(
    "SELECT COUNT(*) AS n FROM driver_device_email_codes WHERE driver_id = ? AND created_at > NOW(3) - INTERVAL 1 HOUR",
    [driverId]
  );
  if (Number(hour?.n || 0) >= MAX_CODES_PER_HOUR) {
    return { sent: false, status: 429, error: "Too many codes have been sent. Wait a while, or call your office." };
  }

  const code = generateCode();
  await db.execute(
    "UPDATE driver_device_email_codes SET revoked_at = NOW(3) WHERE device_id = ? AND used_at IS NULL AND revoked_at IS NULL",
    [deviceId]
  );
  const [ins] = await db.execute(
    `INSERT INTO driver_device_email_codes (company_id, driver_id, device_id, code_hash, sent_to, expires_at)
     VALUES (?, ?, ?, ?, ?, NOW(3) + INTERVAL ${CODE_TTL_MINUTES} MINUTE)`,
    [driver.company_id, driverId, deviceId, codeHash(deviceId, code), email]
  );

  const mail = await sendDriverMail({
    to: email,
    ...driverDeviceCodeEmail({
      name: driver.first_name,
      code,
      minutes: CODE_TTL_MINUTES,
      employeeNo: driver.employee_no,
      phone: phoneLabel(userAgent),
      firstPhone,
    }),
  });
  if (!mail?.sent) {
    // A code nobody received must not linger as a live one.
    await db.execute("UPDATE driver_device_email_codes SET revoked_at = NOW(3) WHERE code_id = ?", [ins.insertId]);
    return { sent: false, status: 503, error: "We couldn't send the email. Try again, or call your office." };
  }
  return { sent: true };
}

/** The waiting phone asks for another email. */
export async function resendDeviceCode({ pending, deviceKey, userAgent }) {
  if (!(await pendingDeviceMatches(db, pending, deviceKey))) return { sent: false, status: 401, error: "Sign in again on this phone." };
  const [[row]] = await db.execute(
    `SELECT d.driver_id, d.company_id, d.first_name, d.employee_no, d.email, d.device_enroll_open,
            d.device_verify_locked_at, dd.status,
            (SELECT COUNT(*) FROM driver_devices a WHERE a.driver_id = d.driver_id AND a.status = 'active') AS active_phones
       FROM drivers d JOIN driver_devices dd ON dd.driver_id = d.driver_id AND dd.device_id = ?
      WHERE d.driver_id = ? AND d.company_id = ? AND d.status = 'active' AND d.app_enabled = 1 LIMIT 1`,
    [pending.deviceId, pending.driverId, pending.companyId]
  );
  if (!row) return { sent: false, status: 401, error: "This account can't sign in. Ask your office." };
  if (row.status !== "pending") return { sent: false, status: 409, error: "This sign-in is no longer waiting. Sign in again." };
  if (row.device_verify_locked_at) return { sent: false, status: 423, error: "Too many wrong codes. Call your office to unlock your account." };
  if (!row.email) return { sent: false, status: 409, error: "There's no email on file for you. Call your office." };
  return sendDeviceCode({
    driver: row,
    deviceId: pending.deviceId,
    email: row.email,
    firstPhone: !Number(row.active_phones) && Boolean(row.device_enroll_open),
    userAgent,
    resend: true,
  });
}

/* ---------------------------------------------------------------- */
/* Telling people                                                   */
/* ---------------------------------------------------------------- */

/** Warn the trusted phone that another phone is asking in. Best effort; never throws. */
export async function warnTrustedPhone({ driver, deviceId }) {
  try {
    publishToDriver(driver.company_id, driver.driver_id, {
      type: "device:pending",
      deviceId,
      message: "Your account was just signed in on another phone. If this wasn't you, call your office now.",
    });
    await notifyDriver({
      companyId: driver.company_id,
      driverId: driver.driver_id,
      title: "New phone sign-in",
      body: "Someone signed in to your account on another phone. If this wasn't you, call your office.",
      tag: "device-pending",
    });
  } catch (err) {
    console.error(`[devices] Could not warn driver ${driver.driver_id} of a new phone: ${err.message}`);
  }
}

/**
 * Put a waiting phone in front of the office: marked as asked, so the bell
 * lists it, and announced live, so the bell rings. Best effort; never throws.
 */
export async function askOffice({ driverId, companyId, deviceId }) {
  try {
    const [res] = await db.execute(
      `UPDATE driver_devices SET office_requested_at = COALESCE(office_requested_at, NOW(3))
        WHERE device_id = ? AND driver_id = ? AND company_id = ? AND status = 'pending'`,
      [deviceId, driverId, companyId]
    );
    if (!res.affectedRows) return false;
    const [[drv]] = await db.execute(
      "SELECT first_name, last_name, employee_no, home_branch_id FROM drivers WHERE driver_id = ? LIMIT 1",
      [driverId]
    );
    if (drv?.home_branch_id) {
      publish(companyId, drv.home_branch_id, {
        type: "driver:device_pending",
        driverId,
        deviceId,
        driverName: `${drv.first_name || ""} ${drv.last_name || ""}`.trim(),
        employeeNo: drv.employee_no,
      });
    }
    return true;
  } catch (err) {
    console.error(`[devices] Could not ask the office about driver ${driverId}'s phone: ${err.message}`);
    return false;
  }
}

/** The waiting phone's driver asks the office to approve it. */
export async function requestOfficeApproval({ pending, deviceKey }) {
  if (!(await pendingDeviceMatches(db, pending, deviceKey))) return { status: 401, error: "Sign in again on this phone." };
  const ok = await askOffice(pending);
  if (!ok) return { status: 409, error: "This sign-in is no longer waiting. Sign in again." };
  return { ok: true };
}

/**
 * The office has dealt with a driver's phones: every console's bell drops the
 * request, not only the one that approved it. Best effort; never throws.
 */
export async function announceResolved({ companyId, driverId }) {
  try {
    const [[drv]] = await db.execute(
      "SELECT home_branch_id FROM drivers WHERE driver_id = ? AND company_id = ? LIMIT 1",
      [driverId, companyId]
    );
    if (drv?.home_branch_id) publish(companyId, drv.home_branch_id, { type: "driver:device_resolved", driverId });
  } catch (err) {
    console.error(`[devices] Could not announce a resolved phone for driver ${driverId}: ${err.message}`);
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
 * The pending phone enters the emailed code. Returns
 *   { token, deviceId, firstPhone }                                  — it is the active phone now
 *   { status, error, wrongCode?, locked?, attemptsLeft?, expired? }  — it is not
 */
export async function verifyWithCode({ pending, code, deviceKey }) {
  const { driverId, deviceId, companyId } = pending;
  if (!(await pendingDeviceMatches(db, pending, deviceKey))) {
    return { status: 401, error: "Sign in again on this phone." };
  }
  const result = await withTransaction(async (conn) => {
    const [[drv]] = await conn.execute(
      `SELECT driver_id, company_id, device_verify_failures, device_verify_locked_at, device_enroll_open
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

    const [[sent]] = await conn.execute(
      `SELECT code_id, code_hash, attempts, (expires_at > NOW(3)) AS live
         FROM driver_device_email_codes
        WHERE device_id = ? AND driver_id = ? AND used_at IS NULL AND revoked_at IS NULL
        ORDER BY code_id DESC LIMIT 1`,
      [deviceId, driverId]
    );
    // Not a guess: there is nothing to guess at. Not counted.
    if (!sent) return { status: 410, error: "There's no code waiting for this phone. Tap \"Send a new code\".", expired: true };
    if (!Number(sent.live)) return { status: 410, error: "That code has expired. Tap \"Send a new code\".", expired: true };

    const typed = normaliseCode(code);
    const right = typed.length === 6 && sameHash(codeHash(deviceId, typed), sent.code_hash);

    if (!right) {
      const attempts = Number(sent.attempts || 0) + 1;
      const spent = attempts >= MAX_CODE_ATTEMPTS;
      await conn.execute(
        `UPDATE driver_device_email_codes SET attempts = ?, revoked_at = ${spent ? "NOW(3)" : "NULL"} WHERE code_id = ?`,
        [attempts, sent.code_id]
      );
      const failures = Number(drv.device_verify_failures || 0) + 1;
      const lock = failures >= MAX_VERIFY_FAILURES;
      await conn.execute(
        `UPDATE drivers SET device_verify_failures = ?, device_verify_locked_at = ${lock ? "NOW(3)" : "NULL"} WHERE driver_id = ?`,
        [failures, driverId]
      );
      if (lock) {
        return { status: 423, error: "Too many wrong codes. Call your office to unlock your account.", wrongCode: true, locked: true };
      }
      if (spent) {
        return { status: 401, error: "Too many wrong tries for this code. Tap \"Send a new code\".", wrongCode: true, expired: true, attemptsLeft: 0 };
      }
      return { status: 401, error: "That code isn't right.", wrongCode: true, attemptsLeft: MAX_CODE_ATTEMPTS - attempts };
    }

    await conn.execute("UPDATE driver_device_email_codes SET used_at = NOW(3) WHERE code_id = ?", [sent.code_id]);
    await conn.execute("UPDATE drivers SET device_verify_failures = 0 WHERE driver_id = ?", [driverId]);
    const [[active]] = await conn.execute(
      "SELECT 1 AS yes FROM driver_devices WHERE driver_id = ? AND status = 'active' LIMIT 1",
      [driverId]
    );
    const firstPhone = !active && Boolean(drv.device_enroll_open);
    const revoked = await activate(conn, { driverId, deviceId, via: firstPhone ? "first_device" : "email_code" });
    return { ok: true, revoked, firstPhone };
  });

  if (!result.ok) {
    // Locked out: only the office can help now, so the office is told.
    if (result.locked) await askOffice(pending);
    return result;
  }
  cutOff(companyId, driverId, result.revoked);
  await announceResolved({ companyId, driverId });
  return { token: signDriverToken({ driverId, companyId, deviceId }), deviceId, firstPhone: result.firstPhone };
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
  if (device.status === "active") return { status: "approved", token: signDriverToken({ driverId, companyId, deviceId }) };
  if (device.status !== "pending") return { status: "refused" };
  return { status: "waiting" };
}

/* ---------------------------------------------------------------- */
/* Office                                                           */
/* ---------------------------------------------------------------- */

async function driverInCompany(runner, companyId, driverId) {
  const [[drv]] = await runner.execute(
    `SELECT driver_id, company_id, email, device_verify_failures, device_verify_locked_at
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
            dd.office_requested_at AS officeRequestedAt,
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
    email: drv.email || null,
    locked: Boolean(drv.device_verify_locked_at),
    failures: Number(drv.device_verify_failures || 0),
  };
}

/**
 * Phones waiting for the office across the company, for the bell: those whose
 * driver asked for the office, and any driver locked out. A driver simply
 * reading their email is not listed. A request nobody has touched for a day is
 * left off: the driver has long since signed in, called, or given up, and it
 * is still on the driver's page.
 */
export async function pendingForOffice({ companyId }) {
  const [rows] = await db.execute(
    `SELECT dd.device_id AS deviceId, dd.driver_id AS driverId,
            COALESCE(dd.office_requested_at, dd.last_seen_at) AS askedAt,
            d.employee_no AS employeeNo, CONCAT_WS(' ', d.first_name, d.last_name) AS driverName,
            (d.device_verify_locked_at IS NOT NULL) AS locked
       FROM driver_devices dd
       JOIN drivers d ON d.driver_id = dd.driver_id AND d.status = 'active'
      WHERE dd.company_id = ? AND dd.status = 'pending' AND dd.last_seen_at > NOW(3) - INTERVAL 1 DAY
        AND (dd.office_requested_at IS NOT NULL OR d.device_verify_locked_at IS NOT NULL)
      ORDER BY askedAt DESC
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
 * no trusted phone left the driver's next phone still needs a code or the
 * office — set-up stays closed (see resolveSignIn).
 */
export async function revokeByOffice({ companyId, driverId, deviceId }) {
  const [res] = await db.execute(
    `UPDATE driver_devices SET status = 'blocked', revoked_at = NOW(3), revoked_reason = 'signed out by the office',
            office_requested_at = NULL
      WHERE device_id = ? AND driver_id = ? AND company_id = ? AND status <> 'blocked'`,
    [deviceId, driverId, companyId]
  );
  if (!res.affectedRows) return { status: 404, error: "Phone not found, or already signed out." };
  await db.execute(
    "UPDATE driver_device_email_codes SET revoked_at = NOW(3) WHERE device_id = ? AND used_at IS NULL AND revoked_at IS NULL",
    [deviceId]
  );
  await db.execute("DELETE FROM driver_push_subscriptions WHERE device_id = ?", [deviceId]);
  disconnectDriverDevices(companyId, driverId, [deviceId]);
  return { ok: true };
}

/**
 * Undo a sign-out: the office blocked a phone by mistake, or it was found. It
 * is not trusted again by this — the next time the driver signs in on it, it
 * waits like any other new phone, for the emailed code or the office.
 */
export async function unblockByOffice({ companyId, driverId, deviceId }) {
  const [res] = await db.execute(
    `UPDATE driver_devices SET status = 'revoked', revoked_at = NOW(3), revoked_reason = 'allowed again by the office'
      WHERE device_id = ? AND driver_id = ? AND company_id = ? AND status = 'blocked'`,
    [deviceId, driverId, companyId]
  );
  if (!res.affectedRows) return { status: 404, error: "Phone not found, or not signed out." };
  return { ok: true };
}

/**
 * Start again: every phone signed out, every code cancelled, the lock lifted,
 * and set-up opened, so the next phone the driver signs in on becomes the
 * trusted one once the emailed code is entered. A phone the office blocked
 * stays blocked.
 */
export async function resetByOffice({ companyId, driverId }) {
  const result = await withTransaction(async (conn) => {
    const drv = await driverInCompany(conn, companyId, driverId);
    if (!drv) return { status: 404, error: "Driver not found." };
    await conn.execute(
      `UPDATE driver_devices SET status = 'revoked', revoked_at = NOW(3), revoked_reason = 'reset by the office',
              office_requested_at = NULL
        WHERE driver_id = ? AND status IN ('pending', 'active')`,
      [driverId]
    );
    await conn.execute(
      "UPDATE driver_device_email_codes SET revoked_at = NOW(3) WHERE driver_id = ? AND used_at IS NULL AND revoked_at IS NULL",
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
