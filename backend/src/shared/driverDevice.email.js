import { layout, greeting, ticket, callout, fineprint, textFooter, brandAttachments, e } from "../modules/auth/email.layout.js";

/**
 * The one-time code that lets a driver sign in to the Driver App on a phone.
 *
 * Sent the moment a phone needs verifying — a new account's first sign-in, or
 * a move to another phone. The code is what matters, so it is the biggest
 * thing in the message and the first thing in the subject; the rest says how
 * long it works, and what to do if the driver did not ask for it, because a
 * code nobody asked for means somebody else has their PIN.
 */

const PIXEL = "'Geist Pixel Square','Silkscreen','Courier New',Consolas,monospace";

/** "482 913": two halves read more easily off one screen and into another. */
export const spacedCode = (code) => `${code.slice(0, 3)} ${code.slice(3)}`;

/** One short secret, shown large and on its own, to be typed into the app. */
export const bigValue = (label, value) => `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 18px">
                  <tr>
                    <td align="center" style="padding:20px 16px;border:1px solid #d9e1ee;border-radius:12px;background:#f1f5ff">
                      <div style="color:#6b7896;font-size:11px;font-weight:700;letter-spacing:0.9px;text-transform:uppercase">${e(label)}</div>
                      <div style="margin-top:8px;color:#0c1a38;font-family:${PIXEL};font-size:34px;font-weight:700;letter-spacing:8px">${e(value)}</div>
                    </td>
                  </tr>
                </table>`;

const bigCode = (code) => bigValue("Your sign-in code", spacedCode(code));

export function driverDeviceCodeEmail({ name, code, minutes, employeeNo, phone, firstPhone }) {
  const hello = name ? `Hi ${name},` : "Hello,";
  const lead = firstPhone
    ? "Welcome to Trackify Driver. Enter this code in the app to finish signing in and set up this phone as yours."
    : "Someone signed in to your Trackify Driver account on a new phone. If it was you, enter this code in the app to use that phone.";
  const details = [
    ...(employeeNo ? [["Employee no.", employeeNo]] : []),
    ...(phone ? [["Phone", phone]] : []),
    ["Valid for", `${minutes} minutes`],
    ["Use", "Once only"],
  ];
  const warning = firstPhone
    ? "If you didn't just sign in, don't share this code. Call your office."
    : "If this wasn't you, don't enter or share this code. Call your office right away. Someone may know your PIN.";

  const text = [
    "AstreaBlue Intelligence Inc. — Trackify, Trip Ticket Management System",
    "DRIVER APP SIGN-IN CODE",
    "",
    hello,
    "",
    lead,
    "",
    `Your code: ${spacedCode(code)}`,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    warning,
    "Your office will never ask you for this code.",
    ...textFooter(),
  ].join("\n");

  const html = layout({
    title: "Your Trackify Driver sign-in code",
    preheader: `Your code is ${spacedCode(code)}. It works once, for ${minutes} minutes.`,
    tag: firstPhone ? "Driver sign-in" : "New phone",
    content: [
      greeting(hello, e(lead)),
      bigCode(code),
      ticket("Code details", details),
      callout(e(warning), { tone: firstPhone ? "info" : "alert" }),
      fineprint("Your office will never ask you for this code."),
    ].join(""),
  });

  return {
    subject: `${spacedCode(code)} is your Trackify Driver sign-in code`,
    text,
    html,
    attachments: brandAttachments(),
  };
}
