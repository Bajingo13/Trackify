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

/* Names are typed by an administrator, so they are escaped before going into HTML. */
const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

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
  const safeHello = escapeHtml(hello);
  const safeWhy = escapeHtml(why);
  const safePassword = escapeHtml(password);
  const safeExpires = escapeHtml(expires);
  const safeSignInUrl = escapeHtml(signInUrl);

  const text = [
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
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Your temporary ${SYSTEM} password</title>
  </head>
  <body style="margin:0;padding:0;background:#eef2f8;color:#10203d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">
      Your temporary Trackify access is ready. Sign in and create your permanent password.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#eef2f8">
      <tr>
        <td align="center" style="padding:36px 12px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dce4f0;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(16,32,61,0.12)">
            <tr>
              <td style="height:6px;background:#2455d6;font-size:0;line-height:0">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:26px 34px 22px;border-bottom:1px solid #e7ecf4">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="46" valign="middle">
                      <div style="width:40px;height:40px;line-height:40px;text-align:center;border-radius:11px;background:#e9f0fe;color:#2455d6;font-size:14px;font-weight:800">AB</div>
                    </td>
                    <td valign="middle" style="padding-left:10px">
                      <div style="font-size:16px;line-height:1.2;font-weight:750;color:#0c1a38">AstreaBlue</div>
                      <div style="margin-top:3px;font-size:10px;line-height:1.3;letter-spacing:1.2px;text-transform:uppercase;color:#71809d">Trackify fleet operations</div>
                    </td>
                    <td align="right" valign="middle">
                      <span style="display:inline-block;padding:5px 9px;border:1px solid #cdebd9;border-radius:999px;background:#effaf3;color:#167347;font-size:10px;font-weight:700">SECURE ACCESS</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 34px 34px">
                <div style="margin:0 0 8px;color:#2455d6;font-size:11px;line-height:1.4;font-weight:750;letter-spacing:1.3px;text-transform:uppercase">Account access</div>
                <h1 style="margin:0 0 14px;color:#0c1a38;font-size:26px;line-height:1.22;letter-spacing:-0.5px">Your temporary access is ready</h1>
                <p style="margin:0 0 12px;color:#33415f;font-size:15px;line-height:1.6">${safeHello}</p>
                <p style="margin:0 0 24px;color:#5f6d88;font-size:14px;line-height:1.65">${safeWhy} Use the password below to sign in securely.</p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:22px;border:1px solid #cfdbef;border-radius:12px;background:#f7f9fd">
                  <tr>
                    <td style="padding:15px 17px">
                      <div style="margin-bottom:7px;color:#8492ad;font-size:10px;line-height:1.3;font-weight:750;letter-spacing:1.2px;text-transform:uppercase">Temporary password</div>
                      <div style="color:#1748c7;font-family:Consolas,'Courier New',monospace;font-size:19px;line-height:1.45;font-weight:700;letter-spacing:0.4px;word-break:break-all">${safePassword}</div>
                    </td>
                  </tr>
                </table>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px">
                  <tr>
                    <td align="center" bgcolor="#2455d6" style="border-radius:10px;background:#2455d6">
                      <a href="${safeSignInUrl}" style="display:inline-block;padding:13px 22px;color:#ffffff;text-decoration:none;font-size:14px;line-height:1.2;font-weight:700">Sign in to Trackify</a>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:20px;border-left:3px solid #2455d6;background:#f2f6ff">
                  <tr>
                    <td style="padding:12px 14px;color:#51617f;font-size:13px;line-height:1.55">
                      <strong style="color:#243451">Expires:</strong> ${safeExpires}<br />
                      You will be asked to create your permanent password immediately after signing in.
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 6px;color:#8793aa;font-size:11px;line-height:1.5">Button not working? Copy and paste this address into your browser:</p>
                <p style="margin:0 0 22px;font-size:12px;line-height:1.5;word-break:break-all"><a href="${safeSignInUrl}" style="color:#2455d6;text-decoration:underline">${safeSignInUrl}</a></p>

                <div style="padding-top:18px;border-top:1px solid #e7ecf4;color:#7a879f;font-size:12px;line-height:1.55">
                  If you were not expecting this email, do not use the password. Contact your administrator so they can secure the account.
                </div>
              </td>
            </tr>
          </table>
          <div style="max-width:600px;padding:16px 20px 0;color:#8995aa;font-size:11px;line-height:1.5;text-align:center">
            This is an automated security message from ${SYSTEM}. Please do not reply.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: `Your temporary ${SYSTEM} password`, text, html };
}
