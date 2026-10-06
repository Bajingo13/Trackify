import { layout, greeting, ticket, button, callout, fineprint, textFooter, brandAttachments, e } from "../modules/auth/email.layout.js";

/**
 * The license-expiry reminder, sent to a client's administrators.
 *
 * Plain about what happens and when: the date, how long is left, and who
 * renews it. It names the license number because that is what support will ask
 * for, and it never says more than the administrator needs — no other client's
 * name, no internal ids.
 */
export function licenseReminderEmail({
  name, companyName, licenseNumber, expires, daysLeft, expired, url, reference, enforced,
}) {
  const hello = name ? `Hi ${name},` : "Hello,";

  const when = expired
    ? "has expired"
    : daysLeft <= 1 ? "expires tomorrow" : `expires in ${daysLeft} days`;
  const subject = expired
    ? `Your Trackify license for ${companyName} has expired`
    : `Your Trackify license for ${companyName} ${when}`;

  const lead = expired
    ? `The Trackify license for <strong>${e(companyName)}</strong> expired on ${e(expires)}.`
    : `The Trackify license for <strong>${e(companyName)}</strong> ${when}, on ${e(expires)}.`;

  const consequence = expired
    ? (enforced
        ? "Your team can no longer sign in or use Trackify until the license is renewed."
        : "Please arrange renewal as soon as possible; access may be restricted without it.")
    : (enforced
        ? "Once it ends, your team will no longer be able to sign in or use Trackify, including the Driver App, until it is renewed."
        : "Please arrange renewal before then to avoid any interruption.");

  const details = [
    ["Company", companyName],
    ["License number", licenseNumber],
    [expired ? "Expired on" : "Valid until", expires],
    ["Status", expired ? "Expired" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`],
  ];

  const text = [
    "AstreaBlue Intelligence Inc. — Trackify, Trip Ticket Management System",
    `LICENSE NOTICE  ${reference}`,
    "",
    hello,
    "",
    lead.replace(/<[^>]+>/g, ""),
    consequence,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    "To renew, contact your AstreaBlue representative and quote the license number above.",
    `View your license: ${url}`,
    ...textFooter(),
  ].join("\n");

  const html = layout({
    title: subject,
    preheader: `${companyName}'s license ${when}. Quote ${licenseNumber} to renew.`,
    tag: expired ? "License expired" : "License expiring",
    reference,
    content: [
      greeting(hello, lead),
      ticket("Trip ticket · License details", details, { accent: expired || daysLeft <= 7 ? "#d64545" : "#2455d6" }),
      callout(e(consequence), { tone: expired || daysLeft <= 7 ? "alert" : "info" }),
      callout("<strong>To renew,</strong> contact your AstreaBlue representative and quote the license number above."),
      button(url, "View license"),
      fineprint("You are receiving this because you administer this company on Trackify."),
    ].join(""),
  });

  return { subject, text, html, attachments: brandAttachments() };
}
