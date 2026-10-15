import { layout, greeting, ticket, button, callout, fineprint, textFooter, brandAttachments, e } from "../modules/auth/email.layout.js";
import { describeExpiry } from "./driverLicense.js";

/**
 * The driver-licence digest, sent to the people who manage drivers.
 *
 * One email per company per day however many licences crossed a threshold, so a
 * fleet with a dozen renewals due in the same fortnight gets one list, not a
 * dozen messages. It says who, what the number is and what the date is — what
 * someone needs to chase it — and states plainly what an expired licence means.
 */
export function driverLicenseDigestEmail({ name, companyName, items, url }) {
  const hello = name ? `Hi ${name},` : "Hello,";
  const expired = items.filter((i) => i.daysLeft < 0);
  const soon = items.filter((i) => i.daysLeft >= 0);

  const subject =
    items.length === 1
      ? `Driver licence ${items[0].daysLeft < 0 ? "expired" : "expiring"}: ${items[0].driver}`
      : `${items.length} driver licences need attention at ${companyName}`;

  const lead =
    items.length === 1
      ? `The driver's licence for <strong>${e(items[0].driver)}</strong> needs attention.`
      : `${items.length} driver licences at <strong>${e(companyName)}</strong> need attention${
          expired.length ? `, ${expired.length} of them already expired` : ""
        }.`;

  const consequence = expired.length
    ? "A driver with an expired licence cannot be assigned to a trip until the new expiry date is recorded."
    : "Renewing takes time. Remind these drivers now, so none of them is taken off the schedule.";

  const row = (i) => [`${i.driver}${i.employeeNo ? ` (${i.employeeNo})` : ""}`, `${describeExpiry(i.daysLeft)} · ${i.expiry}`];
  const details = [...expired, ...soon].map(row);

  const text = [
    "AstreaBlue Intelligence Inc. — Trackify, Trip Ticket Management System",
    "DRIVER LICENCE NOTICE",
    "",
    hello,
    "",
    lead.replace(/<[^>]+>/g, ""),
    consequence,
    "",
    ...[...expired, ...soon].map((i) => `${row(i)[0]} — ${row(i)[1]}${i.licenseNo ? ` — ${i.licenseNo}` : ""}`),
    "",
    `Open the driver list: ${url}`,
    ...textFooter(),
  ].join("\n");

  const html = layout({
    title: subject,
    preheader: `${items.length} driver licence${items.length === 1 ? "" : "s"} expiring or expired.`,
    tag: expired.length ? "Licence expired" : "Licence expiring",
    content: [
      greeting(hello, lead),
      ticket("Driver licences", details, { accent: expired.length ? "#d64545" : "#2455d6" }),
      callout(e(consequence), { tone: expired.length ? "alert" : "info" }),
      button(url, "Open drivers"),
      fineprint("You are receiving this because you manage drivers on Trackify."),
    ].join(""),
  });

  return { subject, text, html, attachments: brandAttachments() };
}
