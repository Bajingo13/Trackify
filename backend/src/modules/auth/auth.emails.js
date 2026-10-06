/**
 * The messages this system sends.
 *
 * Written plainly, because each arrives at a moment when somebody is either
 * locked out and anxious, or wondering whether their account has been taken.
 * No tracking and nothing loaded from elsewhere; the logo travels inside the
 * message. They share the Trackify look in email.layout.js.
 *
 * Every one is sent as text and HTML. Some Philippine mail setups still strip
 * HTML outright, and a reset link nobody can click is the same as no email.
 */
import { layout, greeting, ticket, button, callout, fineprint, textFooter, brandAttachments, e } from "./email.layout.js";

const SYSTEM = "AstreaBlue Trackify";

/** The reset link. Valid once, and not for long. */
export function resetEmail({ name, url, minutes, email }) {
  const hello = name ? `Hi ${name},` : "Hello,";
  const lead = "Somebody asked to reset the password for your Trackify account. Use the button below to choose a new one.";
  const details = [
    ...(email ? [["Account", email]] : []),
    ["Link valid for", `${minutes} minutes`],
    ["Use", "Once only"],
  ];

  const text = [
    "AstreaBlue Intelligence Inc. — Trackify, Trip Ticket Management System",
    "PASSWORD RESET",
    "",
    hello,
    "",
    lead,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    "Open this link to choose a new one:",
    url,
    "",
    `The link works once and stops working after ${minutes} minutes.`,
    "",
    "If this wasn't you, you can ignore this message — your password has not changed. If it keeps happening, tell your administrator.",
    "AstreaBlue will never ask for your password by email.",
    ...textFooter(),
  ].join("\n");

  const html = layout({
    title: "Reset your Trackify password",
    preheader: `Choose a new password. The link works once, for ${minutes} minutes.`,
    tag: "Password reset",
    content: [
      greeting(hello, e(lead)),
      ticket("Reset details", details),
      button(url, "Choose a new password"),
      callout("If this wasn't you, ignore this message — <strong>your password has not changed.</strong> If it keeps happening, tell your administrator."),
      fineprint("AstreaBlue will never ask for your password by email."),
    ].join(""),
  });

  return { subject: `Reset your ${SYSTEM} password`, text, html, attachments: brandAttachments() };
}

/**
 * The confirmation, which is the half that catches a theft.
 *
 * A reset link that reaches the wrong person is only discovered because the
 * right person gets this and knows they did not do it. So it says when and
 * from where, and what to do about it.
 */
export function passwordChangedEmail({ name, when, ip, viaReset, email }) {
  const hello = name ? `Hi ${name},` : "Hello,";
  const how = viaReset ? "using a reset link" : "from the profile page";
  const where = ip ? ` from ${ip}` : "";
  const details = [
    ...(email ? [["Account", email]] : []),
    ["Changed", when],
    ["Method", viaReset ? "Reset link" : "Profile page"],
    ...(ip ? [["From", ip]] : []),
  ];

  const text = [
    "AstreaBlue Intelligence Inc. — Trackify, Trip Ticket Management System",
    "SECURITY NOTICE",
    "",
    hello,
    "",
    `The password on your ${SYSTEM} account was changed ${how} on ${when}${where}.`,
    "",
    "If that was you, there is nothing to do.",
    "",
    "If it was not, tell your administrator straight away so they can deactivate the account. Anyone already signed in stays signed in until their session runs out, within 8 hours.",
    ...textFooter(),
  ].join("\n");

  const html = layout({
    title: "Your Trackify password was changed",
    preheader: `Your password was changed ${how} on ${when}.`,
    tag: "Security notice",
    content: [
      greeting(hello, `The password on your Trackify account was changed ${e(how)} on <strong>${e(when)}</strong>${e(where)}. If that was you, there is nothing to do.`),
      ticket("Change details", details),
      callout(
        "<strong>Wasn't you?</strong> Tell your administrator straight away so they can deactivate the account. Anyone already signed in stays signed in until their session runs out, within 8 hours.",
        { tone: "alert" }
      ),
      fineprint("AstreaBlue will never ask for your password by email."),
    ].join(""),
  });

  return { subject: `Your ${SYSTEM} password was changed`, text, html, attachments: brandAttachments() };
}

/**
 * A temporary password, sent to the person it belongs to.
 *
 * Sent here rather than shown on the administrator's screen so it passes
 * through as few hands as possible: not an API response, not a browser's
 * memory, not a chat message it was pasted into. It only lets somebody choose
 * a password of their own, and stops working when it expires.
 */
export function temporaryAccessEmail({ name, password, expires, signInUrl, firstAccount }) {
  const hello = name ? `Hi ${name},` : "Hello,";
  const why = firstAccount
    ? `An account has been set up for you on ${SYSTEM}.`
    : `Your administrator has issued you new temporary access to ${SYSTEM}.`;
  const lead = `${why} Use the password below to sign in securely.`;
  const details = [
    ["Sign in at", signInUrl],
    ["Expires", expires],
  ];

  const text = [
    "AstreaBlue Intelligence Inc. — Trackify, Trip Ticket Management System",
    "TEMPORARY ACCESS",
    "",
    hello,
    "",
    why,
    "",
    `Sign in at ${signInUrl} with this email address and the temporary password:`,
    "",
    `    ${password}`,
    "",
    `It stops working on ${expires}. You will be asked to choose your own password as soon as you sign in.`,
    "",
    "If you were not expecting this, tell your administrator and do not use it.",
    ...textFooter(),
  ].join("\n");

  const passwordBox = `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 18px;border:1px solid #bcd0fb;border-radius:12px;background:#f1f5ff">
                  <tr>
                    <td style="padding:15px 18px">
                      <div style="margin-bottom:7px;color:#6b7896;font-size:10.5px;line-height:1.3;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">Temporary password</div>
                      <div style="color:#1741b6;font-family:Consolas,'Courier New',monospace;font-size:20px;line-height:1.45;font-weight:700;letter-spacing:0.5px;word-break:break-all">${e(password)}</div>
                    </td>
                  </tr>
                </table>`;

  const html = layout({
    title: `Your temporary ${SYSTEM} password`,
    preheader: "Your temporary Trackify access is ready. Sign in and create your permanent password.",
    tag: "Temporary access",
    content: [
      greeting(hello, e(lead)),
      passwordBox,
      ticket("Trip ticket · Access details", details),
      button(signInUrl, "Sign in to Trackify"),
      callout("You'll be asked to <strong>create your permanent password</strong> immediately after signing in."),
      fineprint(
        "If you were not expecting this email, do not use the password. Contact your administrator so they can secure the account.",
        "AstreaBlue will never ask for your password by email."
      ),
    ].join(""),
  });

  return { subject: `Your temporary ${SYSTEM} password`, text, html, attachments: brandAttachments() };
}
