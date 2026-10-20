import { layout, greeting, ticket, button, callout, fineprint, textFooter, brandAttachments, e } from "../modules/auth/email.layout.js";
import { bigValue } from "./driverDevice.email.js";

/**
 * The PIN emails a driver gets: their first PIN when the office registers
 * them, a new one when the office sends it, and a notice whenever it changes.
 *
 * The office never sees a PIN the system makes; this email is the only place
 * it exists in plain text. So each one says plainly to keep it to themselves,
 * and how to change it in the app.
 */

const HEAD = "AstreaBlue Intelligence Inc. — Trackify, Trip Ticket Management System";

function pinEmail({ kind, subject, tag, hello, lead, pin, employeeNo, url, steps }) {
  const details = [
    ["Employee no.", employeeNo],
    ["Sign in at", url],
  ];
  const keep = "Keep your PIN to yourself. Your office will never ask you for it. You can change it any time in the app under Profile → Change PIN.";

  const text = [
    HEAD,
    kind,
    "",
    hello,
    "",
    lead,
    "",
    `Your PIN: ${pin}`,
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    keep,
    ...textFooter(),
  ].join("\n");

  const html = layout({
    title: subject,
    preheader: `Your Driver App PIN and how to sign in. Employee no. ${employeeNo}.`,
    tag,
    content: [
      greeting(hello, e(lead)),
      bigValue("Your PIN", pin),
      ticket("Sign-in details", details),
      `<ol style="margin:20px 0 0;padding-left:20px;color:#44526f;font-size:14px;line-height:1.7">${steps.map((s) => `<li>${e(s)}</li>`).join("")}</ol>`,
      button(url, "Open Trackify Driver"),
      callout(e(keep)),
      fineprint("If you weren't expecting this, call your office."),
    ].join(""),
  });

  return { subject, text, html, attachments: brandAttachments() };
}

/** A new driver's account: their Employee Number and first PIN. */
export function driverWelcomeEmail({ name, employeeNo, pin, url, companyName }) {
  return pinEmail({
    kind: "DRIVER APP ACCOUNT",
    subject: "Your Trackify Driver account is ready",
    tag: "Driver account",
    hello: name ? `Hi ${name},` : "Hello,",
    lead: `${companyName ? `${companyName} has` : "Your office has"} set up your Trackify Driver account. Here is your PIN.`,
    pin, employeeNo, url,
    steps: [
      "Open Trackify Driver on your phone.",
      `Sign in with your employee number (${employeeNo}) and this PIN.`,
      "We'll email you a 6-digit code to confirm it's you. Enter it to finish.",
      "Change your PIN to one only you know, from Profile → Change PIN.",
    ],
  });
}

/** The office sent a new PIN: the old one no longer works. */
export function driverNewPinEmail({ name, employeeNo, pin, url }) {
  return pinEmail({
    kind: "NEW DRIVER APP PIN",
    subject: "Your new Trackify Driver PIN",
    tag: "New PIN",
    hello: name ? `Hi ${name},` : "Hello,",
    lead: "Your office has sent you a new PIN for Trackify Driver. Your old PIN no longer works.",
    pin, employeeNo, url,
    steps: [
      `Sign in with your employee number (${employeeNo}) and this PIN.`,
      "Change it to one only you know, from Profile → Change PIN.",
    ],
  });
}

/**
 * The PIN changed. Says when, and what to do if it wasn't them: this is how a
 * driver finds out someone else got in. It never contains the PIN.
 */
export function driverPinChangedEmail({ name, when, employeeNo }) {
  const hello = name ? `Hi ${name},` : "Hello,";
  const lead = "The PIN for your Trackify Driver account was just changed from the app.";
  const details = [
    ...(employeeNo ? [["Employee no.", employeeNo]] : []),
    ["Changed", when],
  ];
  const warning = "If this wasn't you, call your office right away. They can sign out your phone and send you a new PIN.";

  const text = [
    HEAD,
    "PIN CHANGED",
    "",
    hello,
    "",
    lead,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    warning,
    ...textFooter(),
  ].join("\n");

  const html = layout({
    title: "Your Trackify Driver PIN was changed",
    preheader: "Your Driver App PIN was changed. If this wasn't you, call your office.",
    tag: "PIN changed",
    content: [
      greeting(hello, e(lead)),
      ticket("Change details", details),
      callout(e(warning), { tone: "alert" }),
      fineprint("If it was you, there's nothing else to do."),
    ].join(""),
  });

  return { subject: "Your Trackify Driver PIN was changed", text, html, attachments: brandAttachments() };
}
