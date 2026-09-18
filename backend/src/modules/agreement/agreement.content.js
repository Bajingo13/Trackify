/**
 * The Terms of Service and Data Privacy Policy, as presented to users.
 *
 * This file is the single source of truth. The frontend renders whatever it is
 * given rather than holding its own copy, so the document a user accepts and
 * the document recorded against their acceptance cannot drift apart.
 *
 * To publish a change: edit the text, raise VERSION, set EFFECTIVE_DATE. Every
 * user is then asked to accept the new version, which is what section 2.2
 * requires. Do not edit the text without raising the version — the acceptance
 * table records a version string, and silently changing what that string refers
 * to would make the consent record meaningless.
 *
 * ── How the claims in this document are kept true ──
 *
 * Every sentence here that describes what the System does is a factual claim,
 * and needs the same verification as a line of code. Writing one from memory of
 * how such systems usually work is how the original two-factor error got in,
 * and how "a session expires after a period of inactivity" got in while that
 * error was being removed. agreement.claims.test.js checks each such claim
 * against the code that implements it, in both directions: the document cannot
 * re-acquire a claim the code does not support, and the code cannot quietly
 * drop a control the document promises. Before editing any clause below,
 * read the implementation; if the test does not already cover the claim you are
 * adding, add the case.
 *
 * ── Verified for 1.3 (2026-09-18) ──
 *
 * Holds as written: sign-in throttling (middleware/loginRateLimit.js, wired to
 * both logins); absolute session expiry with no refresh path (8h staff, 12h
 * Driver App); bcrypt hashing for passwords and driver PINs; role access scoped
 * by company and branch (middleware/operationalContext.js); the location fields
 * and the persistent notification.
 *
 * ── Known discrepancies between this text and the system as built ──
 *
 *   • UNRESOLVED, and the most serious — a driver who uses only the Trackify
 *     Driver application cannot accept this Agreement, and no code path lets
 *     them. The agreement routes are mounted behind the staff `authenticate`
 *     middleware, which rejects a Driver App token outright; the drivers table
 *     has no user_id, so a driver has no users row to record an acceptance
 *     against; and /driver/* is mounted outside the AgreementGate. So section
 *     4.3 offers consent-by-acceptance as a legal basis for precisely the
 *     collection described in 4.1.1 — driver location — from the one group that
 *     has no way to give it. Resolving it means either a driver-side acceptance
 *     step (an endpoint keyed on driver_id, its own acceptance record, and a
 *     gate in the app) or counsel confirming a different basis for employed
 *     drivers. Both are the operator's decision, not a wording fix.
 *   • RESOLVED in 1.3 — five claims were corrected after checking them against
 *     the code: 2.1 said an account is not activated until acceptance (accounts
 *     are created active; acceptance gates access, not activation); 4.1 claimed
 *     sign-in activity including device and browser information was collected
 *     (nothing records sign-ins at all — no table, no audit action, no
 *     last-login column); 4.2 gave "communication of account/security events"
 *     as a purpose (there is no email or SMS capability in the system);
 *     4.6 said every action is written to an audit trail (the operations module
 *     makes no audit calls; trip lifecycle changes go to trip_status_history
 *     instead); and 4.1.1 said recording begins when the driver starts a trip
 *     (it begins when the driver switches sharing on, which the app offers from
 *     the moment dispatch releases the trip — one status earlier). 2.2 and 4.4
 *     were amended for the same reason: to describe how notice is actually
 *     given, and to disclose the public geocoding service addresses are sent to.
 *   • RESOLVED in 1.2 — sections 3.2, 4.6 and 5.1 previously declared two
 *     factor authentication mandatory, which Trackify does not implement, so
 *     every user was accepting a statement about a control that did not exist.
 *     Amended at the operator's direction to describe the controls that are
 *     actually in place, and to say plainly that two factor authentication is
 *     not offered — an absence stated outright cannot be mistaken for an
 *     oversight. Section 5.1's "recognized device" exemption went with it:
 *     there is no device-recognition feature, so nothing could be revoked.
 *   • RESOLVED in 1.1 — section 4.1.1 now discloses driver location: what is
 *     collected, when recording starts and stops, that it continues with the
 *     screen locked, and that a persistent notification is shown throughout.
 *     This was added because omitting it is a disclosure defect under the Data
 *     Privacy Act, not a matter of preference.
 *   • The Data Protection Officer's number (02-5310-0423) and the general
 *     contact number (02-5310-0243) differ by two transposed digits. One of
 *     them is likely a typing error.
 *
 * Every change since 1.0 narrows what the operator asserts rather than what the
 * user owes, but these are still amendments to a legal document and want
 * counsel's eye.
 */

export const VERSION = "1.3";
export const EFFECTIVE_DATE = "2026-09-18";
export const TITLE = "Terms of Service and Data Privacy Policy";
export const SYSTEM_NAME = "AstreaBlue Trackify";

export const INTRO =
  "Welcome to AstreaBlue Trackify (“the System”). This Agreement governs your " +
  "use of the System and incorporates both our Terms of Service and Data " +
  "Privacy Policy. By creating an account, accepting an invitation, or " +
  "continuing to use the System, you agree to be bound by this Agreement. If " +
  "you do not agree, you must discontinue use of the System.";

export const SECTIONS = [
  {
    heading: "Company Information",
    paragraphs: [
      "The System is operated by AstreaBlue Intelligence Inc., a Makati based software development and implementation company specializing in compliance driven enterprise solutions.",
      "The System is a trip ticket management and BIR compliant invoicing and accounting platform designed for registered client companies (“Client Companies”) and their authorized users (“you,” “User”).",
    ],
  },
  {
    heading: "Acceptance and Account Activation",
    items: [
      "2.1 You must review and accept this Agreement before you can use the System, whether your account was created directly or by invitation from a Client Company administrator. Acceptance is required when you sign in; until it is given, the System does not open.",
      "2.2 When this Agreement is revised, the revised version is presented to you in the System at your next sign-in and must be accepted before the System will open. Notice is given in the application itself: the System does not send email or text messages.",
      "2.3 You must be duly authorized by your Client Company to use the System on its behalf.",
    ],
  },
  {
    heading: "Use of the System",
    items: [
      "3.1 The System may only be used for lawful business purposes relating to trip management, invoicing, accounting, tax compliance, and related administrative functions.",
      "3.2 You are responsible for safeguarding your login credentials and for all activity under your account. Repeated failed sign-in attempts are temporarily blocked. A session expires a fixed period after sign-in — eight hours in the web System, twelve hours in the Trackify Driver application — regardless of activity, after which you must sign in again.",
      "3.3 Unauthorized access, circumvention of security features, or misuse of data belonging to other Client Companies is strictly prohibited.",
      "3.4 Financial documents generated through the System (invoices, official receipts, statements of account, debit/credit notes) are legal and tax documents. You are solely responsible for the accuracy of the information you enter.",
    ],
  },
  {
    heading: "Data Privacy (Republic Act No. 10173 — Data Privacy Act of 2012)",
    items: [
      "4.1 Personal Data Collected: Your name, email address, role, and company or branch affiliation; the record of your acceptance of this Agreement (the version accepted, the date and time, the IP address and the browser identification it was accepted from); and, for the actions described in 4.6, audit trail entries recording what was done, who did it, and the IP address it came from. Sign-in events themselves are not recorded.",
      "4.1.1 Driver Location Data: For users of the Trackify Driver mobile application, the System records precise location (latitude, longitude, speed, heading and accuracy) while a trip is released or in transit. Recording begins only when the driver switches on “Share my location”, which the application offers once dispatch has released the trip, and ends when the driver switches it off, when the delivery is confirmed, or when the trip moves to any other status — the System refuses location data for a trip that is not released or in transit. While recording, it continues with the application in the background and the device locked, because a driver cannot hold a device while operating a vehicle, and the application displays a persistent notification stating that the position is being shared for as long as it continues. Location is not recorded at any other time.",
      "4.2 Purpose of Processing: Authentication, account security, System operation and improvement, audit trail maintenance for BIR compliance, and fulfillment of legal obligations. Driver location data is processed to show the dispatch office the position of a vehicle carrying a load, to provide customers with arrival estimates, and to establish a record of a delivery where it is later disputed.",
      "4.3 Legal Basis: Consent, given by accepting this Agreement; contractual necessity with your Client Company; and compliance with Philippine tax and corporate law.",
      "4.4 Data Sharing: Limited to (a) your Client Company administrators, (b) service providers under confidentiality obligations, for hosting, (c) the public OpenStreetMap Nominatim geocoding service, to which addresses entered into the System — trip origins, destinations and stops — are sent to be turned into map coordinates; this is a public service operating under its own terms rather than a confidentiality agreement with AstreaBlue, and nothing identifying you or a driver is sent with the address, and (d) government authorities such as the Bureau of Internal Revenue when legally required.",
      "4.5 Data Retention: Retained while your account is active and thereafter for the period mandated by Philippine tax/accounting laws. Secure disposal or anonymization follows statutory retention. Driver location records are retained as part of the trip record to which they belong.",
      "4.6 Security Measures: Passwords and driver PINs are stored only as irreversible hashes and are never held in readable form; access is controlled by role and scoped to a Client Company and branch; repeated failed sign-in attempts are throttled, counted both per account and per network address; administrative, master data, fleet, warehouse, finance and Driver App actions are written to an audit trail recording the acting user and IP address, and every change to a trip's status is recorded in that trip's own history together with the user who made it; and data is encrypted in transit. The audit trail covers the actions named here rather than every action in the System. The System does not currently offer two factor authentication.",
      "4.7 Your Rights: You may exercise rights to information, access, correction, objection, erasure/blocking (subject to retention laws), portability, and complaint filing under the Data Privacy Act.",
      "4.8 Data Protection Officer: Contact our DPO at admin@astreablue.com / 02-5310-0423.",
    ],
  },
  {
    heading: "Account Security",
    items: [
      "5.1 Accounts are accessed with an email address and password, or in the Trackify Driver application with an employee number and PIN. Two factor authentication is not currently offered; where it becomes available, this Agreement will be revised and re-issued for acceptance under Section 2.2.",
      "5.2 Report suspected unauthorized access immediately to connect@astreablue.com.",
    ],
  },
  {
    heading: "Termination",
    items: [
      "6.1 Client Company administrators may revoke user access at their discretion.",
      "6.2 AstreaBlue may suspend or terminate accounts that violate this Agreement, applicable law, or pose a security risk.",
    ],
  },
  {
    heading: "Changes to this Agreement",
    paragraphs: [
      "AstreaBlue may update this Agreement periodically. Material changes will be reflected in a new version number and effective date. New users must accept the current version before the System will open; existing users are asked to accept a revision as outlined in Section 2.2.",
    ],
  },
  {
    heading: "Contact Information",
    paragraphs: [
      "For inquiries regarding this Agreement, contact AstreaBlue Intelligence Inc. at 02-5310-0243 or email at connect@astreablue.com.",
    ],
  },
];

export const ACCEPTANCE_STATEMENT =
  "By accepting this Agreement, you acknowledge that you have read, understood, " +
  "and agree to be bound by these Terms of Service and Data Privacy Policy.";

/** The whole document, as the frontend receives it. */
export function agreementDocument() {
  return {
    version: VERSION,
    effectiveDate: EFFECTIVE_DATE,
    title: TITLE,
    systemName: SYSTEM_NAME,
    intro: INTRO,
    sections: SECTIONS,
    acceptanceStatement: ACCEPTANCE_STATEMENT,
  };
}

/** Every sentence of the document, as one string, for the claims test. */
export function agreementText() {
  const parts = [INTRO, ACCEPTANCE_STATEMENT];
  for (const section of SECTIONS) {
    parts.push(section.heading);
    parts.push(...(section.paragraphs || []));
    parts.push(...(section.items || []));
  }
  return parts.join("\n");
}
