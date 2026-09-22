/**
 * The two messages this system sends.
 *
 * Written plainly, because both arrive at a moment when somebody is either
 * locked out and anxious, or wondering whether their account has been taken.
 * Neither is a marketing email: no images, no tracking, nothing that a mail
 * client has to load from somewhere else.
 *
 * Both are sent as text and HTML. Some Philippine mail setups still strip HTML
 * outright, and a reset link nobody can click is the same as no email.
 */

const SYSTEM = "AstreaBlue Trackify";

/* Inlined, because a stylesheet cannot travel with an email. */
const WRAP = (body) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c2333;max-width:520px;margin:0 auto;padding:24px">
  <div style="font-weight:700;font-size:16px;letter-spacing:-0.01em;margin-bottom:18px">${SYSTEM}</div>
  ${body}
  <hr style="border:none;border-top:1px solid #e3e7ef;margin:26px 0 14px" />
  <div style="font-size:12px;color:#6b7690">
    This is an automated message from ${SYSTEM}. Nobody monitors replies to it.
  </div>
</div>`;

/** The reset link. Valid once, and not for long. */
export function resetEmail({ name, url, minutes }) {
  const hello = name ? `Hi ${name},` : "Hello,";

  const text = [
    hello,
    "",
    `Somebody asked to reset the password for your ${SYSTEM} account.`,
    "",
    "Open this link to choose a new one:",
    url,
    "",
    `The link works once and stops working after ${minutes} minutes.`,
    "",
    "If this wasn't you, you can ignore this message — your password has not changed. If it keeps happening, tell your administrator.",
  ].join("\n");

  const html = WRAP(`
    <p style="margin:0 0 14px">${hello}</p>
    <p style="margin:0 0 18px">Somebody asked to reset the password for your ${SYSTEM} account.</p>
    <p style="margin:0 0 22px">
      <a href="${url}" style="display:inline-block;background:#2455d6;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Choose a new password</a>
    </p>
    <p style="margin:0 0 6px;font-size:13px;color:#6b7690">Or paste this into your browser:</p>
    <p style="margin:0 0 18px;font-size:13px;word-break:break-all"><a href="${url}" style="color:#2455d6">${url}</a></p>
    <p style="margin:0 0 14px;font-size:13px;color:#6b7690">The link works once and stops working after ${minutes} minutes.</p>
    <p style="margin:0;font-size:13px;color:#6b7690">If this wasn't you, ignore this message — your password has not changed. If it keeps happening, tell your administrator.</p>
  `);

  return { subject: `Reset your ${SYSTEM} password`, text, html };
}

/**
 * The confirmation, which is the half that catches a theft.
 *
 * A reset link that reaches the wrong person is only discovered because the
 * right person gets this and knows they did not do it. So it says when and
 * from where, and what to do about it.
 */
export function passwordChangedEmail({ name, when, ip, viaReset }) {
  const hello = name ? `Hi ${name},` : "Hello,";
  const how = viaReset ? "using a reset link" : "from the profile page";
  const where = ip ? ` from ${ip}` : "";

  const text = [
    hello,
    "",
    `The password on your ${SYSTEM} account was changed ${how} on ${when}${where}.`,
    "",
    "If that was you, there is nothing to do.",
    "",
    "If it was not, tell your administrator straight away so they can deactivate the account. Anyone already signed in stays signed in until their session runs out, within 8 hours.",
  ].join("\n");

  const html = WRAP(`
    <p style="margin:0 0 14px">${hello}</p>
    <p style="margin:0 0 18px">The password on your ${SYSTEM} account was changed ${how} on <strong>${when}</strong>${where}.</p>
    <p style="margin:0 0 14px">If that was you, there is nothing to do.</p>
    <p style="margin:0;color:#c23b3b">If it was not, tell your administrator straight away so they can deactivate the account. Anyone already signed in stays signed in until their session runs out, within 8 hours.</p>
  `);

  return { subject: `Your ${SYSTEM} password was changed`, text, html };
}
