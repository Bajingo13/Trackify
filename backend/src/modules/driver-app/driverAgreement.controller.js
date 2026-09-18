/**
 * Accepting the Terms of Service and Data Privacy Policy in the Driver App.
 *
 * The staff acceptance routes cannot serve a driver: they are mounted behind
 * `authenticate`, which rejects a Driver App token by design, and they key the
 * consent record on a users row a driver does not have. So this is the same
 * logic keyed on driver_id, reading the *same* agreement.content.js — the
 * document a driver accepts and the document a dispatcher accepts have to be
 * the same document, or the version string in either consent record stops
 * meaning anything.
 *
 * Section 4.1.1 collects a driver's precise location, and section 4.3 gives
 * consent as a legal basis for it. This is what makes that basis true for the
 * people it is collected from.
 */
import db from "../../config/db.js";
import { VERSION, agreementDocument } from "../agreement/agreement.content.js";

/**
 * The caller's address, preferring what the proxy reports.
 *
 * Railway terminates TLS in front of the app, so req.ip is the proxy without
 * this. A consent record that stores the load balancer's address for every
 * driver records nothing worth keeping.
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

/** Has this driver accepted the version currently published? */
async function acceptanceFor(driverId) {
  const [[row]] = await db.execute(
    `SELECT accepted_at FROM driver_agreement_acceptances
      WHERE driver_id = ? AND version = ? LIMIT 1`,
    [driverId, VERSION]
  );
  return row ? { accepted: true, acceptedAt: row.accepted_at } : { accepted: false, acceptedAt: null };
}

/**
 * The document, plus whether this driver has accepted this version of it.
 *
 * Both together in one response, for the same reason as the staff route: the
 * app has to decide whether to show the gate before it renders anything, and
 * two requests would flash the trip list behind the gate on a phone with one
 * bar of signal.
 */
export async function current(req, res) {
  const state = await acceptanceFor(req.driver.driverId);
  res.json({
    success: true,
    data: { ...agreementDocument(), ...state },
  });
}

export async function accept(req, res) {
  const { driverId } = req.driver;

  // The version is taken from the server, never from the request. A client that
  // could name the version it was accepting could accept a version it was never
  // shown, and the consent record would be worthless.
  await db.execute(
    `INSERT INTO driver_agreement_acceptances (driver_id, version, ip_address, user_agent)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE acceptance_id = acceptance_id`,
    [driverId, VERSION, callerIp(req), userAgent(req)]
  );

  const state = await acceptanceFor(driverId);
  res.json({ success: true, data: { version: VERSION, ...state } });
}
