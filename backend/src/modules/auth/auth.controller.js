import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { loadAuthProfile } from "./auth.service.js";
import { passwordProblem } from "../../shared/passwordPolicy.js";

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const [rows] = await db.execute(
      `SELECT user_id, email, password_hash, first_name, last_name, status,
              must_change_password, temporary_password_expires_at
       FROM users WHERE email = ?`,
      [email]
    );

    const user = rows[0];
    // Constant-ish: always run a compare so timing doesn't leak account existence.
    const hash = user?.password_hash || "$2b$10$0000000000000000000000000000000000000000000000000000";
    const valid = await bcrypt.compare(password, hash);

    /*
     * Sign-ins are recorded, successful or not.
     *
     * Nothing recorded them before: no table, no audit entry, no last-login
     * column — so "who signed in, when, from where" had no answer at all, which
     * is the first question anyone asks after an incident. The attempted
     * address goes in the summary rather than actor_email, because on a failure
     * there is no actor to attribute it to and pretending otherwise would put
     * an unauthenticated string in a column meaning "this user".
     */
    if (!user || !valid) {
      await recordAudit(req, {
        module: "auth",
        action: "sign_in.failed",
        entityType: "user",
        entityId: user?.user_id ?? null,
        summary: `Failed sign-in for ${email}`,
        metadata: { reason: user ? "wrong password" : "no such account" },
      });
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    if (user.status !== "active") {
      await recordAudit(req, {
        module: "auth",
        action: "sign_in.refused",
        entityType: "user",
        entityId: user.user_id,
        summary: `Sign-in refused for ${email} — account is ${user.status}`,
      });
      return res.status(403).json({ success: false, message: "Account is inactive." });
    }

    if (
      user.must_change_password &&
      (!user.temporary_password_expires_at || new Date(user.temporary_password_expires_at).getTime() <= Date.now())
    ) {
      await recordAudit(req, {
        module: "auth",
        action: "sign_in.refused",
        entityType: "user",
        entityId: user.user_id,
        summary: `Sign-in refused for ${email} - temporary password expired`,
      });
      return res.status(403).json({
        success: false,
        code: "TEMP_PASSWORD_EXPIRED",
        message: "This temporary password has expired. Ask the System Administrator for new access.",
      });
    }

    const profile = await loadAuthProfile(user.user_id);

    // A role built entirely from driverapp.* permissions (e.g. "Driver") has
    // nothing to do on the staff web console — every page would come up
    // empty. Point them at the driver app instead of issuing a staff token.
    const isDriverAppOnly =
      profile.permissions.length > 0 &&
      profile.permissions.every((p) => p.startsWith("driverapp."));
    if (isDriverAppOnly) {
      return res.status(403).json({
        success: false,
        code: "DRIVER_APP_ONLY",
        message: "This account only has Driver App access. Sign in at /driver with your employee number and PIN instead.",
      });
    }

    const mustChangePassword = Boolean(user.must_change_password);
    const token = signToken({ userId: user.user_id, email: user.email, mustChangePassword });

    // The actor is known now, so the entry can be attributed properly.
    req.user = { userId: user.user_id, email: user.email };
    await recordAudit(req, {
      module: "auth",
      action: "sign_in",
      entityType: "user",
      entityId: user.user_id,
      summary: `Signed in as ${user.email}`,
      metadata: { userAgent: String(req.headers["user-agent"] || "").slice(0, 255) || null },
    });

    res.json({
      success: true,
      message: "Login successful.",
      data: {
        token,
        user: {
          userId: profile.user.userId,
          email: profile.user.email,
          firstName: profile.user.firstName,
          lastName: profile.user.lastName,
          mustChangePassword,
          temporaryPasswordExpiresAt: profile.user.temporaryPasswordExpiresAt,
        },
        access: profile.access,
        roles: profile.roles,
        permissions: profile.permissions,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function activateAccount(req, res) {
  const newPassword = String(req.body.newPassword || "");
  const [rows] = await db.execute(
    `SELECT user_id, email, password_hash, status, must_change_password,
            temporary_password_expires_at
     FROM users WHERE user_id = ? LIMIT 1`,
    [req.user.userId]
  );
  const user = rows[0];
  if (!user || user.status !== "active") {
    return res.status(403).json({ success: false, message: "Account is not active." });
  }
  if (!user.must_change_password) {
    return res.status(409).json({ success: false, message: "This account has already been activated." });
  }
  if (
    !user.temporary_password_expires_at ||
    new Date(user.temporary_password_expires_at).getTime() <= Date.now()
  ) {
    return res.status(403).json({
      success: false,
      code: "TEMP_PASSWORD_EXPIRED",
      message: "This temporary password has expired. Ask the System Administrator for new access.",
    });
  }

  const problem = passwordProblem(newPassword, { email: user.email });
  if (problem) return res.status(400).json({ success: false, message: problem });
  if (await bcrypt.compare(newPassword, user.password_hash)) {
    return res.status(400).json({
      success: false,
      message: "Your permanent password must be different from the temporary password.",
    });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const [updated] = await db.execute(
    `UPDATE users
     SET password_hash = ?, must_change_password = FALSE, temporary_password_expires_at = NULL
     WHERE user_id = ? AND must_change_password = TRUE`,
    [passwordHash, user.user_id]
  );
  if (updated.affectedRows !== 1) {
    return res.status(409).json({ success: false, message: "This account has already been activated." });
  }

  req.user.mustChangePassword = false;
  await recordAudit(req, {
    module: "auth",
    action: "account.initial_password.change",
    entityType: "user",
    entityId: user.user_id,
    summary: `Completed first-login password setup for ${user.email}`,
  });

  const profile = await loadAuthProfile(user.user_id);
  const token = signToken({ userId: user.user_id, email: user.email, mustChangePassword: false });
  return res.json({
    success: true,
    message: "Account activated.",
    data: {
      token,
      user: profile.user,
      access: profile.access,
      roles: profile.roles,
      permissions: profile.permissions,
    },
  });
}

/**
 * GET /api/auth/me
 * Optional X-Company-Id / X-Branch-Id headers scope the returned permissions to
 * that operating context; otherwise the user's first access entry is used.
 */
export async function getMe(req, res, next) {
  try {
    const companyId = Number(req.headers["x-company-id"]) || null;
    const branchId = Number(req.headers["x-branch-id"]) || null;

    const profile = await loadAuthProfile(req.user.userId, { companyId, branchId });
    if (!profile) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    res.json({
      success: true,
      data: {
        user: profile.user,
        access: profile.access,
        roles: profile.roles,
        permissions: profile.permissions,
        scope: profile.scope,
      },
    });
  } catch (error) {
    next(error);
  }
}
