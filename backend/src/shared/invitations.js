import crypto from "node:crypto";
import { isMailConfigured, send } from "./mailer.js";
import { invitationEmail } from "../modules/auth/invitation.email.js";

/**
 * Account invitations: how a new person gets into Trackify.
 *
 * An administrator never chooses or sees the new user's password. They send
 * an invitation; the person opens a single-use link, confirms their name and
 * sets a password only they know.
 *
 *   • The token is random and stored only as a hash (user_invitations), so a
 *     database dump yields no working links.
 *   • Sending again revokes the previous link, so a forwarded old email stops
 *     working.
 *   • When the email cannot be sent, the administrator is handed the link to
 *     pass on — a single-use link, never a password.
 */

/* Three days: long enough for somebody who checks email once a day. */
export const INVITATION_HOURS = 72;

/* A slow mail server must not hold the admin's request past the browser's own timeout. */
const SEND_TIMEOUT_MS = 15_000;

export const hashInvitationToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

let mail = { isMailConfigured, send };
/** Swap mail out in tests. Pass nothing to put the real one back. */
export function __setInvitationMail(fake) {
  mail = fake ?? { isMailConfigured, send };
}

const frontendBase = () => (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

export function invitationUrl(token) {
  return `${frontendBase()}/accept-invite?token=${encodeURIComponent(token)}`;
}

/** "Oct 3, 2026, 4:14 PM PHT" — an exact time, since the email may be read a day later. */
export function formatInvitationExpiry(date) {
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
  return `${when} PHT`;
}

export const invitationReference = (id) => `INV-${String(id).padStart(6, "0")}`;

/**
 * A fresh link for `userId`, revoking any still outstanding. Returns the plain
 * token — the only copy there will ever be.
 */
export async function issueInvitation(runner, { userId, invitedBy = null }) {
  await runner.execute(
    "UPDATE user_invitations SET revoked_at = NOW() WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL",
    [userId]
  );
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_HOURS * 60 * 60 * 1000);
  const [result] = await runner.execute(
    "INSERT INTO user_invitations (user_id, token_hash, expires_at, invited_by) VALUES (?, ?, ?, ?)",
    [userId, hashInvitationToken(token), expiresAt, invitedBy]
  );
  return { token, expiresAt, invitationId: result.insertId };
}

/** What the invitation's ticket shows: role, company, branch, inviter. */
export async function invitationDetails(runner, { userId, companyId, invitedBy }) {
  const [[user]] = await runner.execute(
    "SELECT email, first_name, last_name FROM users WHERE user_id = ? LIMIT 1",
    [userId]
  );
  const [[access]] = await runner.execute(
    `SELECT c.company_name, b.branch_name
       FROM user_company_access uca
       JOIN companies c ON c.company_id = uca.company_id
       LEFT JOIN branches b ON b.branch_id = uca.branch_id
      WHERE uca.user_id = ? AND (? IS NULL OR uca.company_id = ?)
      ORDER BY uca.access_id LIMIT 1`,
    [userId, companyId ?? null, companyId ?? null]
  );
  const [roles] = await runner.execute(
    `SELECT DISTINCT r.role_name
       FROM user_roles ur JOIN roles r ON r.role_id = ur.role_id
      WHERE ur.user_id = ? AND ur.status = 'active' AND (? IS NULL OR ur.company_id = ?)
      ORDER BY r.role_name`,
    [userId, companyId ?? null, companyId ?? null]
  );
  let inviterName = null;
  if (invitedBy) {
    const [[inviter]] = await runner.execute(
      "SELECT first_name, last_name FROM users WHERE user_id = ? LIMIT 1",
      [invitedBy]
    );
    inviterName = inviter ? [inviter.first_name, inviter.last_name].filter(Boolean).join(" ") : null;
  }
  return {
    email: user?.email,
    firstName: user?.first_name,
    lastName: user?.last_name,
    companyName: access?.company_name || null,
    branchName: access?.branch_name || null,
    role: roles.map((r) => r.role_name).join(", ") || null,
    inviterName,
  };
}

/**
 * Issue a link and email it. Returns what the administrator's screen needs:
 *   { delivery: "email", expiresAt }                              — sent
 *   { delivery: "link", inviteUrl, deliveryProblem, expiresAt }  — hand it over
 */
export async function sendInvitation(runner, { userId, companyId = null, invitedBy = null, timeoutMs = SEND_TIMEOUT_MS }) {
  const { token, expiresAt, invitationId } = await issueInvitation(runner, { userId, invitedBy });
  const details = await invitationDetails(runner, { userId, companyId, invitedBy });
  const url = invitationUrl(token);
  const handover = (problem) => ({ delivery: "link", inviteUrl: url, deliveryProblem: problem, expiresAt });

  if (!mail.isMailConfigured()) {
    return handover("Email is not set up on this server, so the invitation could not be sent.");
  }

  const message = invitationEmail({
    name: details.firstName,
    inviterName: details.inviterName,
    role: details.role,
    companyName: details.companyName,
    branchName: details.branchName,
    email: details.email,
    expires: formatInvitationExpiry(expiresAt),
    url,
    reference: invitationReference(invitationId),
  });

  let timer;
  const result = await Promise.race([
    mail.send({ to: details.email, ...message }),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ sent: false, reason: "timed out" }), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));

  if (result.sent) return { delivery: "email", expiresAt };

  // The reason goes to the log, not the screen: it can hold server details.
  console.error(`[invitation] email to user ${userId} not sent: ${result.reason}`);
  return handover("The invitation email could not be sent.");
}
