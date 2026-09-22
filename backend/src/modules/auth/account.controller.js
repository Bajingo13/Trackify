/**
 * The things a person can change about their own account.
 *
 * Until now they could change nothing. My Profile was a read-only card, the
 * camera button toasted "not available yet", and there was no way at all to
 * change a password — not here, and not through a reset, because the system
 * has no mailer. The only route was to ask an administrator, which is what the
 * sign-in screen was recently made to say honestly.
 *
 * Honesty about it was the right stopgap. This is the fix.
 *
 * Everything that could be used to take an account over — the password and the
 * email address you sign in with — requires the current password, even though
 * the caller is already holding a valid token. A token can be lifted from an
 * unlocked screen; the password cannot be read off one.
 */
import bcrypt from "bcrypt";
import fsSync from "node:fs";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { passwordProblem } from "../../shared/passwordPolicy.js";
import { toRelative, toAbsolute, discard } from "../finance/receipts.storage.js";

const BCRYPT_COST = 10; // matches every other hash in the system

/** The current password, checked before anything security-relevant. */
async function confirmPassword(userId, candidate) {
  const [[row]] = await db.execute(
    "SELECT password_hash, email FROM users WHERE user_id = ? LIMIT 1",
    [userId]
  );
  if (!row) return { ok: false, status: 404, message: "Account not found." };
  if (typeof candidate !== "string" || !candidate) {
    return { ok: false, status: 400, message: "Enter your current password." };
  }
  const matches = await bcrypt.compare(candidate, row.password_hash);
  if (!matches) {
    // Deliberately not "wrong password for user X" — this is the same wording
    // whether the account exists or not, and it is recorded either way.
    return { ok: false, status: 400, message: "That is not your current password." };
  }
  return { ok: true, row };
}

/* ---------------------------------------------------------------- */
/* Name and email                                                   */
/* ---------------------------------------------------------------- */

export async function updateMyProfile(req, res) {
  const userId = req.user.userId;
  const [[current]] = await db.execute(
    "SELECT first_name, last_name, email FROM users WHERE user_id = ? LIMIT 1",
    [userId]
  );
  if (!current) return res.status(404).json({ success: false, message: "Account not found." });

  const firstName = req.body.firstName === undefined
    ? current.first_name
    : String(req.body.firstName).trim();
  const lastName = req.body.lastName === undefined
    ? current.last_name
    : String(req.body.lastName).trim();

  if (!firstName || !lastName) {
    return res.status(400).json({ success: false, message: "A first and last name are both required." });
  }
  if (firstName.length > 100 || lastName.length > 100) {
    return res.status(400).json({ success: false, message: "A name can be at most 100 characters." });
  }

  /*
   * The email is the thing you sign in with, so changing it is an account
   * takeover in one step if a borrowed session can do it unchallenged.
   */
  let email = current.email;
  if (req.body.email !== undefined && String(req.body.email).trim().toLowerCase() !== current.email.toLowerCase()) {
    email = String(req.body.email).trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
      return res.status(400).json({ success: false, message: "That does not look like an email address." });
    }

    const confirmed = await confirmPassword(userId, req.body.currentPassword);
    if (!confirmed.ok) {
      return res.status(confirmed.status).json({
        success: false,
        message: `${confirmed.message} Changing the address you sign in with needs it.`,
      });
    }

    const [[taken]] = await db.execute(
      "SELECT user_id FROM users WHERE email = ? AND user_id <> ? LIMIT 1",
      [email, userId]
    );
    if (taken) {
      return res.status(409).json({ success: false, message: "Another account already uses that email." });
    }
  }

  await db.execute(
    "UPDATE users SET first_name = ?, last_name = ?, email = ? WHERE user_id = ?",
    [firstName, lastName, email, userId]
  );

  const changes = [];
  if (firstName !== current.first_name || lastName !== current.last_name) {
    changes.push(`name ${current.first_name} ${current.last_name} → ${firstName} ${lastName}`);
  }
  if (email !== current.email) changes.push(`email ${current.email} → ${email}`);

  if (changes.length) {
    await recordAudit(req, {
      module: "auth",
      action: "account.profile.update",
      entityType: "user",
      entityId: userId,
      summary: `Updated own profile: ${changes.join(", ")}`,
      metadata: { from: current, to: { first_name: firstName, last_name: lastName, email } },
    });
  }

  res.json({
    success: true,
    data: { firstName, lastName, email },
    // The token still carries the old address; say so rather than let the
    // header quietly disagree with the profile until the session expires.
    message: email !== current.email
      ? "Saved. Sign in with your new email address next time."
      : "Saved.",
  });
}

/* ---------------------------------------------------------------- */
/* Password                                                         */
/* ---------------------------------------------------------------- */

export async function changeMyPassword(req, res) {
  const userId = req.user.userId;
  const { currentPassword, newPassword } = req.body;

  const confirmed = await confirmPassword(userId, currentPassword);
  if (!confirmed.ok) {
    await recordAudit(req, {
      module: "auth",
      action: "account.password.refused",
      entityType: "user",
      entityId: userId,
      summary: "Password change refused: the current password did not match",
    });
    return res.status(confirmed.status).json({ success: false, message: confirmed.message });
  }

  const problem = passwordProblem(newPassword, { email: confirmed.row.email });
  if (problem) return res.status(400).json({ success: false, message: problem });

  if (await bcrypt.compare(newPassword, confirmed.row.password_hash)) {
    return res.status(400).json({ success: false, message: "That is already your password." });
  }

  await db.execute("UPDATE users SET password_hash = ? WHERE user_id = ?", [
    await bcrypt.hash(newPassword, BCRYPT_COST),
    userId,
  ]);

  await recordAudit(req, {
    module: "auth",
    action: "account.password.change",
    entityType: "user",
    entityId: userId,
    summary: "Changed own password",
  });

  /*
   * Said plainly because it is not what most people assume. Sessions are
   * stateless JWTs with no server-side record, so a token issued before this
   * moment keeps working until it expires — at most eight hours. Ending other
   * sessions immediately would mean checking every request against the
   * database, which is a separate piece of work and a cost on every route.
   */
  res.json({
    success: true,
    message:
      "Password changed. Other devices already signed in stay signed in until their session expires, within 8 hours.",
  });
}

/* ---------------------------------------------------------------- */
/* Photograph                                                       */
/* ---------------------------------------------------------------- */

export async function myPhoto(req, res) {
  const [[row]] = await db.execute(
    "SELECT photo_path, photo_mime FROM users WHERE user_id = ? LIMIT 1",
    [req.user.userId]
  );
  if (!row?.photo_path) {
    return res.status(404).json({ success: false, message: "No photo on file." });
  }
  const abs = toAbsolute(row.photo_path);
  if (!fsSync.existsSync(abs)) {
    // A row pointing at a file that is not on disk is usually an unmounted
    // volume. Saying so beats a stack trace.
    return res.status(404).json({ success: false, message: "The photo is missing from storage." });
  }
  res.type(row.photo_mime || "image/jpeg");
  return fsSync.createReadStream(abs).pipe(res);
}

export async function uploadMyPhoto(req, res) {
  const file = req.file;
  if (!file) return res.status(400).json({ success: false, message: "No photo was attached." });

  const userId = req.user.userId;
  const [[existing]] = await db.execute(
    "SELECT photo_path FROM users WHERE user_id = ? LIMIT 1",
    [userId]
  );

  await db.execute(
    `UPDATE users
        SET photo_path = ?, photo_mime = ?, photo_size = ?, photo_updated_at = NOW()
      WHERE user_id = ?`,
    [toRelative(file.path), file.mimetype, file.size, userId]
  );

  // Only after the row points at the new file — losing the old one before the
  // new one is recorded would leave an account with no photo at all.
  if (existing?.photo_path) {
    try {
      discard(toAbsolute(existing.photo_path));
    } catch {
      /* already gone, or outside the root */
    }
  }

  await recordAudit(req, {
    module: "auth",
    action: "account.photo.upload",
    entityType: "user",
    entityId: userId,
    summary: "Updated own profile photo",
  });

  res.json({ success: true, message: "Photo saved.", data: { updatedAt: new Date().toISOString() } });
}

export async function removeMyPhoto(req, res) {
  const userId = req.user.userId;
  const [[existing]] = await db.execute(
    "SELECT photo_path FROM users WHERE user_id = ? LIMIT 1",
    [userId]
  );

  await db.execute(
    `UPDATE users
        SET photo_path = NULL, photo_mime = NULL, photo_size = NULL, photo_updated_at = NOW()
      WHERE user_id = ?`,
    [userId]
  );

  if (existing?.photo_path) {
    try {
      discard(toAbsolute(existing.photo_path));
    } catch {
      /* already gone */
    }
  }

  await recordAudit(req, {
    module: "auth",
    action: "account.photo.remove",
    entityType: "user",
    entityId: userId,
    summary: "Removed own profile photo",
  });

  res.json({ success: true, message: "Photo removed." });
}
