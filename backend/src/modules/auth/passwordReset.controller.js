/**
 * Getting back into an account you are locked out of.
 *
 * This is the only part of the system a stranger can reach without signing in,
 * so it is written defensively:
 *
 *   • The answer to "reset my password" is the same sentence whether or not
 *     the address belongs to an account. Otherwise this page becomes a way to
 *     find out who works here, one address at a time.
 *
 *   • The token is random, single use, short lived, and stored only as a hash
 *     — a database dump must not yield working links.
 *
 *   • Asking for a new link invalidates the ones already outstanding, so a
 *     person who clicks "send it again" three times does not leave three
 *     working keys in three emails.
 *
 *   • Using a link invalidates every other link for that account, because the
 *     reason somebody resets a password is often that they think somebody else
 *     has been in it.
 */
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { passwordProblem } from "../../shared/passwordPolicy.js";
import { send, isMailConfigured, mailConfigurationProblem } from "../../shared/mailer.js";
import { resetEmail, passwordChangedEmail } from "./auth.emails.js";

const BCRYPT_COST = 10;

/**
 * Sixty minutes. Long enough to walk back to the office and read the email,
 * short enough that a link left sitting in an inbox stops being a key.
 */
export const RESET_MINUTES = Number(process.env.PASSWORD_RESET_MINUTES) || 60;

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const clientIp = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.socket?.remoteAddress ||
  null;

/** Where the person lands to type the new password. */
function resetUrl(token) {
  const base = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

/*
 * The same words in every case: address not known, account deactivated, mail
 * server refused. A stranger learns nothing; the person who owns the account
 * gets the email.
 */
const NEUTRAL =
  "If that address belongs to an account, a reset link is on its way. It is valid for one use and expires shortly.";

/* ---------------------------------------------------------------- */
/* Ask for a link                                                   */
/* ---------------------------------------------------------------- */

export async function requestPasswordReset(req, res) {
  const email = String(req.body.email || "").trim().toLowerCase();

  /*
   * Refused early, and loudly, only when the operator has not configured mail
   * at all. This is not an account-existence leak — it is true regardless of
   * the address typed — and the alternative is a screen that says "check your
   * email" on a server that cannot send one.
   */
  if (!isMailConfigured()) {
    console.error(`[reset] ${mailConfigurationProblem()}`);
    return res.status(503).json({
      success: false,
      message:
        "Password reset by email is not available on this server yet. Ask your administrator to reset it for you.",
    });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: "Enter the email address you sign in with." });
  }

  const [[user]] = await db.execute(
    "SELECT user_id, first_name, email, status FROM users WHERE email = ? LIMIT 1",
    [email]
  );

  // Recorded either way. A run of requests for addresses that do not exist is
  // somebody probing, and that is only visible if the misses are logged too.
  await recordAudit(req, {
    module: "auth",
    action: "password.reset.request",
    entityType: "user",
    entityId: user?.user_id ?? null,
    summary: user
      ? `Password reset link requested for ${email}`
      : `Password reset requested for an address with no account: ${email}`,
    metadata: { email, matched: Boolean(user), status: user?.status ?? null },
  });

  if (user && user.status === "active") {
    // Anything already outstanding stops working now.
    await db.execute(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL",
      [user.user_id]
    );

    const token = crypto.randomBytes(32).toString("base64url");
    await db.execute(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?)`,
      [user.user_id, hashToken(token), RESET_MINUTES, clientIp(req)]
    );

    const message = resetEmail({
      name: user.first_name,
      url: resetUrl(token),
      minutes: RESET_MINUTES,
    });
    const result = await send({ to: user.email, ...message });

    if (!result.sent) {
      // Logged for the operator; the caller still gets the neutral sentence,
      // because "we could not send to that address" would confirm it exists.
      console.error(`[reset] link for user ${user.user_id} was not sent: ${result.reason}`);
    }
  }

  res.json({ success: true, message: NEUTRAL });
}

/* ---------------------------------------------------------------- */
/* Check a link before asking for a new password                    */
/* ---------------------------------------------------------------- */

/**
 * So the screen can say "this link has expired" up front, rather than after
 * somebody has carefully typed a new password twice.
 */
export async function checkResetToken(req, res) {
  const token = String(req.query.token || req.params.token || "");
  if (!token) return res.status(400).json({ success: false, message: "No reset link was provided." });

  const [[row]] = await db.execute(
    `SELECT t.token_id, t.used_at, t.expires_at, u.email, u.status
       FROM password_reset_tokens t
       JOIN users u ON u.user_id = t.user_id
      WHERE t.token_hash = ? LIMIT 1`,
    [hashToken(token)]
  );

  const valid = row && !row.used_at && new Date(row.expires_at) > new Date() && row.status === "active";
  if (!valid) {
    return res.status(410).json({
      success: false,
      message: "This reset link has expired or has already been used. Ask for a new one.",
    });
  }

  res.json({
    success: true,
    // Enough to reassure the person they are resetting the right account,
    // without printing the whole address on a page reached by a link.
    data: { email: row.email.replace(/^(.).*(@.*)$/, (_, a, b) => `${a}•••${b}`) },
  });
}

/* ---------------------------------------------------------------- */
/* Use the link                                                     */
/* ---------------------------------------------------------------- */

export async function completePasswordReset(req, res) {
  const token = String(req.body.token || "");
  const newPassword = req.body.newPassword;

  if (!token) return res.status(400).json({ success: false, message: "No reset link was provided." });

  const [[row]] = await db.execute(
    `SELECT t.token_id, t.user_id, t.used_at, t.expires_at,
            u.email, u.first_name, u.status, u.password_hash
       FROM password_reset_tokens t
       JOIN users u ON u.user_id = t.user_id
      WHERE t.token_hash = ? LIMIT 1`,
    [hashToken(token)]
  );

  const valid = row && !row.used_at && new Date(row.expires_at) > new Date() && row.status === "active";
  if (!valid) {
    await recordAudit(req, {
      module: "auth",
      action: "password.reset.refused",
      entityType: "user",
      entityId: row?.user_id ?? null,
      summary: "A reset link was used that had expired, been used already, or did not exist",
    });
    return res.status(410).json({
      success: false,
      message: "This reset link has expired or has already been used. Ask for a new one.",
    });
  }

  const problem = passwordProblem(newPassword, { email: row.email });
  if (problem) {
    // The link is deliberately NOT consumed here: the person typed something
    // the rules refuse, and burning their one link for that would send them
    // back to the start for a fixable mistake.
    return res.status(400).json({ success: false, message: problem });
  }

  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("UPDATE users SET password_hash = ? WHERE user_id = ?", [hash, row.user_id]);
    // This link, and every other one outstanding for the account.
    await connection.execute(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL",
      [row.user_id]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  await recordAudit(req, {
    module: "auth",
    action: "password.reset.complete",
    entityType: "user",
    entityId: row.user_id,
    summary: `Password reset using an emailed link for ${row.email}`,
  });

  /*
   * The confirmation is the half that catches a theft: if the link reached the
   * wrong person, this is how the right one finds out. Sent after the change
   * is committed, and a failure to send is never allowed to undo it — the
   * password really has changed either way, and saying otherwise would lock
   * somebody out of an account whose password they just set.
   */
  const result = await send({
    to: row.email,
    ...passwordChangedEmail({
      name: row.first_name,
      when: new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" }),
      ip: clientIp(req),
      viaReset: true,
    }),
  });
  if (!result.sent) {
    console.error(`[reset] confirmation to user ${row.user_id} was not sent: ${result.reason}`);
  }

  res.json({ success: true, message: "Your password has been changed. You can sign in with it now." });
}

/** Shared with the signed-in change on the profile screen. */
export async function sendPasswordChangedNotice(req, user) {
  const result = await send({
    to: user.email,
    ...passwordChangedEmail({
      name: user.first_name,
      when: new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" }),
      ip: clientIp(req),
      viaReset: false,
    }),
  });
  if (!result.sent) {
    console.error(`[mail] password-change notice not sent: ${result.reason}`);
  }
  return result;
}
