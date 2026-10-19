import crypto from "node:crypto";
import webpush from "web-push";
import db from "../../config/db.js";

/**
 * Notices to a driver's phone: "the office replied", "your pause was approved".
 *
 * Web Push, with the app's own keys (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in the
 * environment; `npm run push:keys` makes a pair). With no keys the feature is
 * simply off: the app is told so and offers nothing, and nothing here throws.
 *
 * What is sent is deliberately thin. A notice shows on a lock screen that other
 * people can see, so it says that something happened and which request it was,
 * never what the office wrote.
 *
 * Sending is best effort and never holds up what triggered it: the reply or the
 * decision is already saved by the time this is called.
 */

const config = () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT || "mailto:support@example.com" };
};

export const pushEnabled = () => Boolean(config());
export const vapidPublicKey = () => config()?.publicKey || null;

// A seam for tests: the real one talks to Google's, Mozilla's or Apple's push service.
let send = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options);
export function useSender(fn) {
  const before = send;
  send = fn || ((subscription, payload, options) => webpush.sendNotification(subscription, payload, options));
  return () => { send = before; };
}

const hashOf = (endpoint) => crypto.createHash("sha256").update(endpoint).digest("hex");
const KEY = /^[A-Za-z0-9_-]{16,200}={0,2}$/;

/** Is this what a browser's PushSubscription.toJSON() looks like? Returns { endpoint, p256dh, auth } or { error }. */
export function checkSubscription(input) {
  const endpoint = typeof input?.endpoint === "string" ? input.endpoint.trim() : "";
  const p256dh = input?.keys?.p256dh;
  const auth = input?.keys?.auth;
  let url;
  try { url = new URL(endpoint); } catch { url = null; }
  if (!url || url.protocol !== "https:" || endpoint.length > 2000) {
    return { error: "That isn't a valid notification address." };
  }
  if (typeof p256dh !== "string" || typeof auth !== "string" || !KEY.test(p256dh) || !KEY.test(auth)) {
    return { error: "That notification subscription is incomplete." };
  }
  return { endpoint, p256dh, auth };
}

/** Register (or re-register) this phone for the driver. Returns { ok } or { error, status }. */
export async function saveSubscription({ driver, subscription, userAgent }) {
  if (!pushEnabled()) return { status: 503, error: "Notifications are not set up on this server." };
  const checked = checkSubscription(subscription);
  if (checked.error) return { status: 400, error: checked.error };
  await db.execute(
    `INSERT INTO driver_push_subscriptions (company_id, driver_id, endpoint, endpoint_hash, p256dh, auth, user_agent, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE company_id = VALUES(company_id), driver_id = VALUES(driver_id),
       p256dh = VALUES(p256dh), auth = VALUES(auth), user_agent = VALUES(user_agent), device_id = VALUES(device_id)`,
    // device_id: the phone that asked, so revoking that phone stops its notices (devices.service.js)
    [driver.companyId, driver.driverId, checked.endpoint, hashOf(checked.endpoint), checked.p256dh, checked.auth,
      String(userAgent || "").slice(0, 255) || null, driver.deviceId ?? null]
  );
  return { ok: true };
}

/** Turn this phone off for the driver. Only their own registration can be removed. */
export async function removeSubscription({ driver, endpoint }) {
  if (typeof endpoint !== "string" || !endpoint) return { status: 400, error: "Say which phone to turn off." };
  const [result] = await db.execute(
    "DELETE FROM driver_push_subscriptions WHERE endpoint_hash = ? AND driver_id = ? AND company_id = ?",
    [hashOf(endpoint), driver.driverId, driver.companyId]
  );
  return { ok: true, removed: result.affectedRows };
}

/**
 * Tell the driver's phones something happened. Returns { sent, removed } and never throws.
 * `tag` replaces an earlier notice about the same thing rather than stacking a second.
 */
export async function notifyDriver({ companyId, driverId, title, body, tag }) {
  const result = { sent: 0, removed: 0 };
  const keys = config();
  if (!keys || !driverId) return result;
  try {
    const [subs] = await db.execute(
      "SELECT subscription_id AS id, endpoint, p256dh, auth FROM driver_push_subscriptions WHERE company_id = ? AND driver_id = ?",
      [companyId, driverId]
    );
    if (!Array.isArray(subs) || !subs.length) return result;
    const payload = JSON.stringify({ title, body, tag: tag || undefined, url: "/driver" });
    await Promise.all(subs.map(async (sub) => {
      try {
        await send(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: "high", vapidDetails: { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey } }
        );
        result.sent += 1;
        await db.execute("UPDATE driver_push_subscriptions SET last_success_at = NOW(3) WHERE subscription_id = ?", [sub.id]);
      } catch (err) {
        // the phone is gone (app removed, permission withdrawn): stop sending to it
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await db.execute("DELETE FROM driver_push_subscriptions WHERE subscription_id = ?", [sub.id]);
          result.removed += 1;
        } else {
          console.error(`[push] Could not notify driver ${driverId}: ${err?.statusCode || ""} ${err?.message || err}`);
        }
      }
    }));
  } catch (err) {
    console.error(`[push] Could not notify driver ${driverId}: ${err.message}`);
  }
  return result;
}
