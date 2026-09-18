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
 * ── Known discrepancies between this text and the system as built ──
 *
 * These are recorded here rather than quietly corrected, because the wording is
 * a legal document and not mine to rewrite:
 *
 *   • Sections 3.2, 4.6 and 5.1 state that two-factor authentication is
 *     mandatory. Trackify does not implement two-factor authentication. As
 *     written, every user accepts a statement about a control that does not
 *     exist.
 *   • RESOLVED in 1.1 — section 4.1.1 now discloses driver location: what is
 *     collected, when recording starts and stops, that it continues with the
 *     screen locked, and that a persistent notification is shown throughout.
 *     This was added because omitting it is a disclosure defect under the Data
 *     Privacy Act, not a matter of preference. It describes what the system
 *     already does and adds no new obligation — but it is still wording in a
 *     legal document and wants the operator's counsel to read it.
 *   • The Data Protection Officer's number (02-5310-0423) and the general
 *     contact number (02-5310-0243) differ by two transposed digits. One of
 *     them is likely a typing error.
 */

export const VERSION = "1.1";
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
      "2.1 You must review and accept this Agreement before your account is activated, whether created directly or via invitation from a Client Company administrator.",
      "2.2 Updates to this Agreement will be communicated to active users. Continued use of the System after an update constitutes acceptance of the revised terms.",
      "2.3 You must be duly authorized by your Client Company to use the System on its behalf.",
    ],
  },
  {
    heading: "Use of the System",
    items: [
      "3.1 The System may only be used for lawful business purposes relating to trip management, invoicing, accounting, tax compliance, and related administrative functions.",
      "3.2 You are responsible for safeguarding your login credentials and for all activity under your account. Two factor authentication is mandatory.",
      "3.3 Unauthorized access, circumvention of security features, or misuse of data belonging to other Client Companies is strictly prohibited.",
      "3.4 Financial documents generated through the System (invoices, official receipts, statements of account, debit/credit notes) are legal and tax documents. You are solely responsible for the accuracy of the information you enter.",
    ],
  },
  {
    heading: "Data Privacy (Republic Act No. 10173 — Data Privacy Act of 2012)",
    items: [
      "4.1 Personal Data Collected: Name, username, email, role, company affiliation, login activity (timestamps, IP address, device/browser information), and audit trail records.",
      "4.1.1 Driver Location Data: For users of the Trackify Driver mobile application, the System records precise location (latitude, longitude, speed, heading and accuracy) while a trip ticket is in progress. Recording begins when the driver starts a trip and ends when the delivery is confirmed or the driver stops sharing; it continues while the application is in the background and the device is locked, because a driver cannot hold a device while operating a vehicle. While recording, the application displays a persistent notification stating that the position is being shared. Location is not recorded outside an active trip.",
      "4.2 Purpose of Processing: Authentication, account security, System operation and improvement, audit trail maintenance for BIR compliance, communication of account/security events, and fulfillment of legal obligations. Driver location data is processed to show the dispatch office the position of a vehicle carrying a load, to provide customers with arrival estimates, and to establish a record of a delivery where it is later disputed.",
      "4.3 Legal Basis: Consent (via acceptance of this Agreement), contractual necessity with your Client Company, and compliance with Philippine tax and corporate law.",
      "4.4 Data Sharing: Limited to (a) your Client Company administrators, (b) service providers under confidentiality obligations, and (c) government authorities such as the Bureau of Internal Revenue when legally required.",
      "4.5 Data Retention: Retained while your account is active and thereafter for the period mandated by Philippine tax/accounting laws. Secure disposal or anonymization follows statutory retention. Driver location records are retained as part of the trip record to which they belong.",
      "4.6 Security Measures: Encrypted password storage, mandatory two factor authentication, role based access control, and audit logging.",
      "4.7 Your Rights: You may exercise rights to information, access, correction, objection, erasure/blocking (subject to retention laws), portability, and complaint filing under the Data Privacy Act.",
      "4.8 Data Protection Officer: Contact our DPO at admin@astreablue.com / 02-5310-0423.",
    ],
  },
  {
    heading: "Account Security",
    items: [
      "5.1 Two factor authentication is required for all accounts unless a recognized device is used. You may revoke recognized devices at any time.",
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
      "AstreaBlue may update this Agreement periodically. Material changes will be reflected in a new version number and effective date. New users must accept the current version before activation; existing users will be notified as outlined in Section 2.2.",
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
