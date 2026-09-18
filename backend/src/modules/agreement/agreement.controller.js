/**
 * Accepting the Terms of Service and Data Privacy Policy.
 *
 * Section 2.1 says an account is not activated until the Agreement is accepted,
 * and 2.2 says a new version must be accepted again. So acceptance is checked
 * against the *current* version, not merely "has this user ever accepted
 * something" — otherwise publishing a revision would silently carry the old
 * consent forward, which is the one thing the version number exists to prevent.
 *
 * These routes deliberately sit behind `authenticate` alone, without the
 * company/branch operating context every other /api/v1 route requires. A user
 * has to be able to read and accept the Agreement before choosing a scope;
 * making acceptance depend on scope would lock out exactly the new user that
 * section 2.1 is about.
 */
import db from "../../config/db.js";
import { VERSION, agreementDocument } from "./agreement.content.js";

/**
 * The caller's address, preferring what the proxy reports.
 *
 * Railway terminates TLS in front of the app, so req.ip is the proxy without
 * this. A consent record that stores the load balancer's address for every user
 * records nothing worth keeping.
 */
function callerIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.ip || req.socket?.remoteAddress || null;
  return ip ? ip.slice(0, 45) : null;
}

const userAgent = (req) => {
  const ua = req.headers["user-agent"];
  return ua ? String(ua).slice(0, 255) : null;
};

/** Has this user accepted the version currently published? */
async function acceptanceFor(userId) {
  const [[row]] = await db.execute(
    `SELECT accepted_at FROM agreement_acceptances
      WHERE user_id = ? AND version = ? LIMIT 1`,
    [userId, VERSION]
  );
  return row ? { accepted: true, acceptedAt: row.accepted_at } : { accepted: false, acceptedAt: null };
}

/**
 * The document, plus whether this user has accepted this version of it.
 *
 * Both together in one response on purpose: the app has to decide whether to
 * show the gate before it can render anything, and splitting that into two
 * requests would flash the application behind the gate on a slow connection.
 */
export async function current(req, res) {
  const state = await acceptanceFor(req.user.userId);
  res.json({
    success: true,
    data: { ...agreementDocument(), ...state },
  });
}

export async function accept(req, res) {
  const { userId } = req.user;

  // The version is taken from the server, never from the request. A client that
  // could name the version it was accepting could accept a version it was never
  // shown, and the consent record would be worthless.
  await db.execute(
    `INSERT INTO agreement_acceptances (user_id, version, ip_address, user_agent)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE acceptance_id = acceptance_id`,
    [userId, VERSION, callerIp(req), userAgent(req)]
  );

  const state = await acceptanceFor(userId);
  res.json({ success: true, data: { version: VERSION, ...state } });
}

/**
 * Every acceptance this user has recorded, newest first.
 *
 * A person is entitled under section 4.7 to see what they consented to and
 * when, and an auditor will ask the same question.
 */
export async function history(req, res) {
  const [rows] = await db.execute(
    `SELECT version, accepted_at FROM agreement_acceptances
      WHERE user_id = ? ORDER BY accepted_at DESC`,
    [req.user.userId]
  );
  res.json({
    success: true,
    data: rows.map((r) => ({ version: r.version, acceptedAt: r.accepted_at })),
  });
}
