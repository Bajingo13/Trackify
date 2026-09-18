import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agreementText } from "./agreement.content.js";

/**
 * The Agreement's factual claims, checked against the code that implements them.
 *
 * Twice now this document has asserted a control the system does not have. The
 * first time it declared two-factor authentication mandatory; the second, while
 * that was being removed, it said a session expires after a period of inactivity
 * when the token carries an absolute expiry and no idle timeout exists anywhere.
 * Both were written from memory of how such systems usually work rather than
 * from the code. A clause describing system behaviour is a factual claim and
 * needs the same verification as a line of code — this file is where that
 * verification lives, so it survives the next edit and the next author.
 *
 * It guards in both directions, which is the point:
 *
 *   • the document cannot re-acquire a claim the code does not support, and
 *   • the code cannot quietly drop a control the document promises — delete the
 *     sign-in throttle and the clause promising it starts failing here.
 *
 * These are deliberately literal. A test that tried to parse legal prose would
 * be unreliable in the direction that matters: quietly passing. Each case below
 * pins one sentence to one piece of code, and says what to do if the answer
 * ever legitimately changes.
 */

const TEXT = agreementText();

const src = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const authRoutes = () => src("../auth/auth.routes.js");
const authController = () => src("../auth/auth.controller.js");
const driverController = () => src("../driver-app/driver.controller.js");
const driversController = () => src("../fleet/drivers.controller.js");
const operationsTables = () => src("../../../migrations/001_operations_tables.sql");
const auditTable = () => src("../../../migrations/004_audit_and_master_data.sql");
const driverTracking = () => src("../../../../frontend/src/driver/tracking.js");

/* ---------------------------------------------------------------- */
/* Claims the document must not make                                */
/* ---------------------------------------------------------------- */

/*
 * Each pattern is a claim that was, or could plausibly be, written into the
 * document from habit while being false here. If one of these features is ever
 * actually built, delete its case — do not loosen the pattern to let the
 * sentence through.
 */
const FORBIDDEN = [
  {
    pattern: /two[ -]factor authentication is (required|mandatory|enabled|in place|available)/i,
    why: "There is no 2FA implementation: no TOTP, no MFA, no OTP secret, anywhere in the backend. Version 1.0 through 1.1 declared it mandatory in three places.",
  },
  {
    pattern: /multi[ -]factor|\bOTP\b|one[ -]time (code|password)/i,
    why: "Same absence, stated another way. Nothing in the system issues or checks a second factor.",
  },
  {
    pattern: /inactiv/i,
    why: "The token is signed with an absolute expiresIn and there is no idle timeout anywhere. A session lasts its full term whether or not it is touched, so any clause about inactivity is false.",
  },
  {
    pattern: /(session|token)[^.]{0,40}(times? out|timeout)/i,
    why: "Same as above — 'timeout' invites the reader to assume an idle timeout that does not exist. Say the session expires a fixed period after sign-in.",
  },
  {
    pattern: /every action is (written|recorded|logged)/i,
    why: "The operations module makes no audit calls at all: creating, editing and dispatching a trip write no audit_logs row. Trip status changes go to trip_status_history instead. 4.6 must name what is covered rather than claim everything is.",
  },
  {
    pattern: /(sign.?in|login) activity[^.]{0,80}(device|browser)/i,
    why: "Nothing records a sign-in: no login_history or sessions table, no last_login column, no audit action for it. IP and browser identification are captured only when this Agreement is accepted.",
  },
  {
    pattern: /recognized device|trusted device|remembered device/i,
    why: "There is no device-recognition feature, so no exemption can turn on one. Removed from 5.1 in version 1.2.",
  },
  {
    pattern: /communication of account.{0,5}security events/i,
    why: "There is no email or SMS capability in the backend — no mailer, no transport, no provider. The notifications settings page is static UI. The System cannot communicate anything outward, so it must not give that as a purpose for holding your email.",
  },
  {
    pattern: /(we|the System) will (email|text|SMS|notify you by)/i,
    why: "Same absence. Notice is given by the in-app gate at next sign-in, and nowhere else.",
  },
  {
    pattern: /recording begins when the driver starts a trip/i,
    why: "Sharing is offered from the moment dispatch releases the trip, one status before the driver taps Start, and the server accepts pings for 'released' as well as 'in_transit'. Recording begins when the driver switches sharing on.",
  },
];

for (const { pattern, why } of FORBIDDEN) {
  test(`the Agreement does not claim: ${pattern}`, () => {
    const match = TEXT.match(pattern);
    assert.equal(
      match,
      null,
      `The Agreement says “${match?.[0]}”, which the code does not support. ${why}`
    );
  });
}

/* ---------------------------------------------------------------- */
/* Claims the document does make, pinned to their implementation    */
/* ---------------------------------------------------------------- */

/*
 * The other direction. Each of these passes today; each fails if someone
 * removes the control while the document goes on promising it. That failure is
 * the useful one — it says "you have just made the Agreement untrue", which is
 * not something code review reliably notices.
 */

test("3.2's sign-in throttle exists and is wired to both sign-in routes", () => {
  assert.match(TEXT, /Repeated failed sign-in attempts are temporarily blocked/);
  assert.match(
    authRoutes(),
    /loginRateLimit\(/,
    "The staff /login route no longer passes through loginRateLimit, so 3.2 is now false for web users."
  );
  assert.match(
    src("../driver-app/driver.routes.js"),
    /loginRateLimit\(/,
    "The Driver App /login route no longer passes through loginRateLimit, so 3.2 is now false for drivers."
  );
});

test("3.2's throttle really is counted per account and per address", () => {
  assert.match(TEXT, /counted both per account and per network address/);
  const limiter = src("../../middleware/loginRateLimit.js");
  assert.match(limiter, /byIdentity/, "The per-identity counter is gone; 4.6 claims both.");
  assert.match(limiter, /byIp/, "The per-IP counter is gone; 4.6 claims both.");
});

test("3.2's session expiry is absolute, with no refresh path", () => {
  assert.match(TEXT, /expires a fixed period after sign-in[^.]*regardless of activity/);
  assert.match(
    authController(),
    /expiresIn: process\.env\.JWT_EXPIRES_IN \|\| "8h"/,
    "The staff session length changed; 3.2 states eight hours."
  );
  assert.match(
    driverController(),
    /expiresIn: process\.env\.DRIVER_JWT_EXPIRES_IN \|\| "12h"/,
    "The Driver App session length changed; 3.2 states twelve hours."
  );
  // A refresh endpoint would make the session sliding rather than fixed, which
  // is the distinction 3.2 turns on.
  assert.doesNotMatch(
    authRoutes() + authController(),
    /refresh/i,
    "A token refresh path has appeared. The session is no longer fixed from sign-in, so 3.2 needs rewriting."
  );
});

test("4.6's hashing claim holds for passwords and for driver PINs", () => {
  assert.match(TEXT, /Passwords and driver PINs are stored only as irreversible hashes/);
  assert.match(authController(), /bcrypt\.hash\(/, "Passwords are no longer hashed with bcrypt.");
  assert.match(driversController(), /bcrypt\.hash\(/, "Driver PINs are no longer hashed with bcrypt.");
  assert.match(driverController(), /bcrypt\.compare\(/, "The Driver App no longer compares against a hash.");
});

test("4.6's audit trail records the acting user and IP address", () => {
  assert.match(TEXT, /recording the acting user and IP address/);
  assert.match(auditTable(), /user_id/, "audit_logs no longer records who acted.");
  assert.match(auditTable(), /ip_address/, "audit_logs no longer records the address acted from.");
});

test("4.1's acceptance record holds exactly what the clause says it does", () => {
  assert.match(TEXT, /the IP address and the browser identification it was accepted from/);
  const migration = src("../../../migrations/027_agreement_acceptances.js");
  assert.match(migration, /ip_address/, "The acceptance record no longer stores an IP address.");
  assert.match(migration, /user_agent/, "The acceptance record no longer stores browser identification.");
  assert.match(src("./agreement.controller.js"), /user_agent/);
});

test("4.1.1's location fields are the ones actually stored", () => {
  assert.match(TEXT, /latitude, longitude, speed, heading and accuracy/);
  const table = operationsTables();
  for (const column of ["latitude", "longitude", "speed_kph", "heading", "accuracy_meters"]) {
    assert.match(
      table,
      new RegExp(column),
      `trip_tracking_points no longer has ${column}, which 4.1.1 says is collected.`
    );
  }
});

test("4.1.1's persistent notification is really shown while recording", () => {
  assert.match(TEXT, /displays a persistent notification/);
  const tracking = driverTracking();
  assert.match(
    tracking,
    /backgroundTitle:/,
    "The background watcher no longer sets a notification title. 4.1.1 promises the driver can always see that recording is on."
  );
  assert.match(tracking, /backgroundMessage:/);
});

test("4.1.1's window is the one the server enforces", () => {
  assert.match(TEXT, /while a trip is released or in transit/);
  assert.match(
    driverController(),
    /\["released", "in_transit"\]\.includes\(asg\.status\)/,
    "The statuses the ping endpoint accepts have changed. 4.1.1 tells the driver exactly when recording is possible, so it has to match."
  );
});

test("4.4 discloses the geocoding service, and nothing personal goes with the address", () => {
  assert.match(TEXT, /OpenStreetMap Nominatim geocoding service/);
  const geo = src("../operations/geo.address.js");
  assert.match(geo, /nominatim\.openstreetmap\.org/);
  // The outbound request carries a fixed product User-Agent and nothing else
  // that identifies anyone — which is what 4.4 tells the user.
  assert.match(geo, /const UA = "AstreaBlueTrackify\/1\.0 \(fleet ops app\)"/);
  assert.doesNotMatch(
    geo,
    /req\.user|userId|driverId|actor_email/,
    "The geocoder now has access to caller identity. 4.4 promises nothing identifying is sent with an address."
  );
});

test("5.1 names the credentials each application actually uses", () => {
  assert.match(TEXT, /email address and password, or in the Trackify Driver application with an employee number and PIN/);
  assert.match(authController(), /SELECT user_id, email, password_hash/);
  assert.match(driverController(), /WHERE employee_no = \?/);
});

/* ---------------------------------------------------------------- */
/* 4.3's consent basis has to reach the people 4.1.1 is about       */
/* ---------------------------------------------------------------- */

/*
 * For three versions this document offered consent-by-acceptance as the legal
 * basis for collecting driver location while a driver who only used the phone
 * had no way to accept it. That is the failure these guard against returning:
 * not a sentence being wrong, but the sentence being right and unreachable.
 */

test("a driver can reach and accept this Agreement from the Driver App", () => {
  const routes = src("../driver-app/driver.routes.js");
  assert.match(routes, /router\.get\("\/agreement"/, "The Driver App can no longer read the Agreement.");
  assert.match(routes, /router\.post\("\/agreement\/accept"/, "The Driver App can no longer accept the Agreement.");

  // Behind the driver's own auth, not in front of it: an unauthenticated caller
  // must not be able to record a consent for somebody else.
  assert.ok(
    routes.indexOf("router.use(authenticateDriver)") < routes.indexOf('router.get("/agreement"'),
    "The agreement routes are no longer behind authenticateDriver."
  );
});

test("a driver's consent is keyed to the driver, in its own record", () => {
  const controller = src("../driver-app/driverAgreement.controller.js");
  assert.match(controller, /req\.driver/, "The driver's identity no longer comes from their token.");
  assert.match(controller, /INSERT INTO driver_agreement_acceptances/);
  assert.match(controller, /ON DUPLICATE KEY UPDATE/, "Accepting twice would become two consents.");
  // A driver has no users row; writing there would fail the foreign key, or
  // worse, attach their consent to a staff account with a coinciding id.
  assert.doesNotMatch(controller, /INSERT INTO agreement_acceptances/);
  assert.match(
    src("../../../migrations/029_driver_agreement_acceptances.js"),
    /CREATE TABLE driver_agreement_acceptances/
  );
});

test("the driver and the office accept the same document", () => {
  // Two copies of the text would make the version string in either consent
  // record meaningless.
  assert.match(
    src("../driver-app/driverAgreement.controller.js"),
    /from "\.\.\/agreement\/agreement\.content\.js"/,
    "The Driver App is no longer serving this file's text."
  );
});

test("the Driver App holds itself closed until the Agreement is accepted", () => {
  assert.match(
    src("../../../../frontend/src/driver/DriverApp.jsx"),
    /<DriverAgreementGate/,
    "The gate is no longer mounted, so a driver could use the app without accepting."
  );
});

/* ---------------------------------------------------------------- */
/* The version rule the acceptance record depends on                */
/* ---------------------------------------------------------------- */

test("the version is a published version string, not a placeholder", async () => {
  const { VERSION, EFFECTIVE_DATE } = await import("./agreement.content.js");
  assert.match(VERSION, /^\d+\.\d+$/, "The acceptance table stores this string; it has to be a real version.");
  assert.match(EFFECTIVE_DATE, /^\d{4}-\d{2}-\d{2}$/);
});
