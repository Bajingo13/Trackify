/**
 * Accepting an account invitation: the page the emailed link opens.
 *
 * Reachable without signing in, so it follows the reset flow's rules: the
 * token is looked up by hash, is single use, expires, and is dead once a newer
 * invitation replaces it. Accepting sets the person's own password and name,
 * activates the account, and signs them straight in.
 */
import bcrypt from "bcrypt";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { passwordProblem } from "../../shared/passwordPolicy.js";
import { hashInvitationToken, invitationDetails } from "../../shared/invitations.js";
import { loadAuthProfile } from "./auth.service.js";
import { signToken, nameProblem } from "./auth.controller.js";

const DEAD = "This invitation has expired or was replaced by a newer one. Ask your administrator to send it again.";
const USED = "This invitation has already been used. Sign in with your email and password.";

async function findInvitation(runner, token, { lock = false } = {}) {
  if (!token) return null;
  const [[row]] = await runner.execute(
    `SELECT i.invitation_id, i.user_id, i.expires_at, i.used_at, i.revoked_at, i.invited_by, u.status
       FROM user_invitations i JOIN users u ON u.user_id = i.user_id
      WHERE i.token_hash = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [hashInvitationToken(token)]
  );
  return row || null;
}

/* Why a found invitation cannot be used, or null if it can. */
function invitationProblem(row) {
  if (!row) return { status: 410, message: DEAD };
  if (row.used_at || row.status === "active") return { status: 410, message: USED, code: "INVITATION_USED" };
  if (row.revoked_at || row.status !== "invited" || new Date(row.expires_at).getTime() <= Date.now()) {
    return { status: 410, message: DEAD, code: "INVITATION_EXPIRED" };
  }
  return null;
}

/* GET /api/auth/invitation?token= — so the page can show the ticket, or say it is dead up front. */
export async function checkInvitation(req, res) {
  const token = String(req.query.token || "");
  if (!token) return res.status(400).json({ success: false, message: "No invitation link was provided." });

  res.set("Cache-Control", "no-store");
  const row = await findInvitation(db, token);
  const problem = invitationProblem(row);
  if (problem) return res.status(problem.status).json({ success: false, code: problem.code, message: problem.message });

  const details = await invitationDetails(db, { userId: row.user_id, invitedBy: row.invited_by });
  return res.json({
    success: true,
    data: { ...details, expiresAt: new Date(row.expires_at).toISOString() },
  });
}

/* POST /api/auth/invitation/accept { token, firstName, lastName, newPassword } */
export async function acceptInvitation(req, res) {
  const token = String(req.body.token || "");
  const newPassword = String(req.body.newPassword || "");
  const firstName = String(req.body.firstName ?? "").trim();
  const lastName = String(req.body.lastName ?? "").trim();

  const badName = nameProblem(firstName, "first name") || nameProblem(lastName, "last name");
  if (badName) return res.status(400).json({ success: false, message: badName });

  const conn = await db.getConnection();
  let accepted;
  try {
    await conn.beginTransaction();
    // Locked, so two tabs submitting the same link cannot both succeed.
    const row = await findInvitation(conn, token, { lock: true });
    const problem = invitationProblem(row);
    if (problem) {
      await conn.rollback();
      return res.status(problem.status).json({ success: false, code: problem.code, message: problem.message });
    }

    const [[user]] = await conn.execute("SELECT email FROM users WHERE user_id = ? LIMIT 1", [row.user_id]);
    const weak = passwordProblem(newPassword, { email: user.email });
    if (weak) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: weak });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await conn.execute(
      `UPDATE users
          SET password_hash = ?, first_name = ?, last_name = ?, status = 'active',
              must_change_password = FALSE, temporary_password_expires_at = NULL
        WHERE user_id = ? AND status = 'invited'`,
      [passwordHash, firstName, lastName, row.user_id]
    );
    await conn.execute("UPDATE user_invitations SET used_at = NOW() WHERE invitation_id = ?", [row.invitation_id]);
    // Any other outstanding link for this person is now pointless.
    await conn.execute(
      "UPDATE user_invitations SET revoked_at = NOW() WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL",
      [row.user_id]
    );
    await conn.commit();
    accepted = { userId: row.user_id, email: user.email };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  req.user = { userId: accepted.userId, email: accepted.email };
  await recordAudit(req, {
    module: "auth",
    action: "user.invite.accept",
    entityType: "user",
    entityId: accepted.userId,
    summary: `Accepted the invitation and set up the account for ${accepted.email}`,
  });

  const profile = await loadAuthProfile(accepted.userId);
  const jwt = signToken({ userId: accepted.userId, email: accepted.email, mustChangePassword: false });
  res.set("Cache-Control", "no-store");
  return res.json({
    success: true,
    message: "Account set up.",
    data: {
      token: jwt,
      user: profile.user,
      access: profile.access,
      roles: profile.roles,
      permissions: profile.permissions,
    },
  });
}
