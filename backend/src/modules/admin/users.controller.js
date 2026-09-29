import bcrypt from "bcrypt";
import crypto from "node:crypto";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { ungrantable, SYSTEM_ADMIN } from "../../shared/rbac.js";
import { loadGrantedCodes } from "../auth/auth.service.js";
import {
  companyAdminUserIds,
  rolesConferAdmin,
  userRoleAssignmentScopes,
} from "../../shared/companyAdmins.js";
import { passwordProblem } from "../../shared/passwordPolicy.js";
import { deliverTemporaryPassword } from "../../shared/temporaryAccess.js";
import { sendInvitation } from "../../shared/invitations.js";

const MIN_PASSWORD = 10;
const TEMPORARY_PASSWORD_HOURS = 72;

function generateTemporaryPassword() {
  return `Tfy!${crypto.randomBytes(12).toString("base64url")}`;
}

/**
 * Reject if any of the target roles carries permissions the actor doesn't hold
 * (System Administrators bypass). Returns an error object or null.
 */
async function checkRoleAssignmentScope(req, roleIds) {
  if (!roleIds.length) return null;
  const ph = roleIds.map(() => "?").join(", ");
  const [permRows] = await db.execute(
    `SELECT DISTINCT p.permission_code
     FROM role_permissions rp
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE rp.role_id IN (${ph})`,
    roleIds
  );
  const targetCodes = permRows.map((r) => r.permission_code);
  const actorCodes = await loadGrantedCodes(
    req.context.userId,
    req.context.companyId,
    req.context.branchId
  );
  const blocked = ungrantable(actorCodes, targetCodes);
  if (blocked.length) {
    const label = blocked.includes(SYSTEM_ADMIN)
      ? "Only a System Administrator can assign the System Administrator role."
      : `You cannot assign a role that grants permissions you do not hold: ${blocked.join(", ")}`;
    return { status: 403, message: label };
  }
  return null;
}

/* GET /api/v1/admin/users?search=&status=&roleId=&page=&limit= */
export async function listUsers(req, res) {
  const { companyId } = req.context;
  const { search = "", status = "" } = req.query;
  const roleId = req.query.roleId ? Number(req.query.roleId) : null;

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;

  const params = [companyId];
  let where = "uca.company_id = ?";

  if (search.trim()) {
    where += " AND (u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)";
    const v = `%${search.trim()}%`;
    params.push(v, v, v);
  }
  if (status === "active" || status === "inactive" || status === "invited") {
    where += " AND u.status = ?";
    params.push(status);
  }
  if (roleId) {
    // EXISTS rather than another JOIN, so it doesn't collapse the roles GROUP_CONCAT below.
    where += ` AND EXISTS (
      SELECT 1 FROM user_roles ur2
      WHERE ur2.user_id = u.user_id AND ur2.company_id = uca.company_id
        AND ur2.status = 'active' AND ur2.role_id = ?
    )`;
    params.push(roleId);
  }

  const [countRows] = await db.execute(
    `SELECT COUNT(DISTINCT u.user_id) AS total
     FROM users u
     JOIN user_company_access uca ON uca.user_id = u.user_id AND uca.status = 'active'
     WHERE ${where}`,
    params
  );
  const total = countRows[0].total;

  const [rows] = await db.execute(
    `SELECT u.user_id, u.email, u.first_name, u.last_name, u.status,
            u.must_change_password, u.temporary_password_expires_at,
            u.created_at, u.updated_at,
            GROUP_CONCAT(DISTINCT r.role_name ORDER BY r.role_name SEPARATOR ', ') AS roles
     FROM users u
     JOIN user_company_access uca ON uca.user_id = u.user_id AND uca.status = 'active'
     LEFT JOIN user_roles ur ON ur.user_id = u.user_id AND ur.company_id = uca.company_id AND ur.status = 'active'
     LEFT JOIN roles r ON r.role_id = ur.role_id
     WHERE ${where}
     GROUP BY u.user_id
     ORDER BY u.first_name ASC, u.last_name ASC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  res.json({
    success: true,
    data: rows,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
}

/* GET /api/v1/admin/users/:id */
export async function getUser(req, res) {
  const { companyId, isSystemAdmin } = req.context;
  const id = Number(req.params.id);

  const [rows] = await db.execute(
    `SELECT u.user_id, u.email, u.first_name, u.last_name, u.status, u.created_at, u.updated_at
     FROM users u
     JOIN user_company_access uca ON uca.user_id = u.user_id AND uca.company_id = ?
     WHERE u.user_id = ? LIMIT 1`,
    [companyId, id]
  );
  if (!rows.length) {
    return res.status(404).json({ success: false, message: "User not found." });
  }

  /*
   * The user was found through this company, but somebody can work for more
   * than one. These lists used to come back for every company the person
   * belonged to, so a client's administrator could read the names of other
   * clients — and their branches and roles there — off the profile of anybody
   * they shared with them. The same rule as every write in this file applies:
   * a company sees its own rows, and only the installation's operator sees
   * across companies.
   */
  const scope = isSystemAdmin ? "" : " AND uca.company_id = ?";
  const [access] = await db.execute(
    `SELECT uca.access_id, uca.company_id, uca.branch_id, uca.status, c.company_name, b.branch_name
     FROM user_company_access uca
     JOIN companies c ON c.company_id = uca.company_id
     LEFT JOIN branches b ON b.branch_id = uca.branch_id
     WHERE uca.user_id = ?${scope}`,
    isSystemAdmin ? [id] : [id, companyId]
  );

  const roleScope = isSystemAdmin ? "" : " AND ur.company_id = ?";
  const [roles] = await db.execute(
    `SELECT ur.user_role_id, ur.role_id, r.role_name, r.is_system, ur.company_id, ur.branch_id, ur.status
     FROM user_roles ur
     JOIN roles r ON r.role_id = ur.role_id
     WHERE ur.user_id = ?${roleScope}`,
    isSystemAdmin ? [id] : [id, companyId]
  );

  // A System Administrator's operating-context list is computed live (see
  // loadAuthProfile) rather than from these access rows, so the UI knows to
  // explain that instead of offering to grant/revoke them here.
  const [sysAdminRows] = await db.execute(
    `SELECT 1
     FROM user_roles ur
     JOIN roles r ON r.role_id = ur.role_id AND r.status = 'active'
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE ur.user_id = ? AND ur.status = 'active' AND p.permission_code = ?
     LIMIT 1`,
    [id, SYSTEM_ADMIN]
  );

  res.json({
    success: true,
    data: { ...rows[0], access, roles, isSystemAdmin: sysAdminRows.length > 0 },
  });
}

/*
 * POST /api/v1/admin/users
 *
 * Invites rather than creates-with-a-password: the account starts 'invited',
 * with an unusable password hash, and the person sets their own password from
 * the emailed link. The administrator never knows it.
 */
export async function createUser(req, res) {
  const { companyId } = req.context;
  const email = String(req.body.email || "").trim().toLowerCase();
  const firstName = String(req.body.firstName || "").trim();
  const lastName = String(req.body.lastName || "").trim();
  const roleIds = Array.isArray(req.body.roleIds)
    ? [...new Set(req.body.roleIds.map(Number).filter(Boolean))]
    : req.body.roleId
    ? [Number(req.body.roleId)]
    : [];
  const branchId = req.body.branchId ? Number(req.body.branchId) : null;

  if (!email || !firstName || !lastName) {
    return res.status(400).json({ success: false, message: "Email, first name and last name are required." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: "Enter a valid email address." });
  }

  const [dupe] = await db.execute("SELECT user_id FROM users WHERE email = ? LIMIT 1", [email]);
  if (dupe.length) {
    return res.status(409).json({ success: false, message: "Email already registered." });
  }

  if (roleIds.length) {
    const ph = roleIds.map(() => "?").join(", ");
    const [valid] = await db.execute(
      `SELECT role_id FROM roles WHERE company_id = ? AND role_id IN (${ph})`,
      [companyId, ...roleIds]
    );
    if (valid.length !== roleIds.length) {
      return res.status(400).json({ success: false, message: "One or more roles are invalid for this company." });
    }
    const err = await checkRoleAssignmentScope(req, roleIds);
    if (err) return res.status(err.status).json({ success: false, message: err.message });
  }
  if (branchId) {
    const [branch] = await db.execute(
      "SELECT branch_id FROM branches WHERE branch_id = ? AND company_id = ? LIMIT 1",
      [branchId, companyId]
    );
    if (!branch.length) {
      return res.status(400).json({ success: false, message: "Invalid branch for this company." });
    }
  }

  let createdId;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // A hash of random bytes nobody holds: the account cannot be signed in to
    // until the invitation sets a real password.
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 10);
    const [result] = await conn.execute(
      `INSERT INTO users (email, password_hash, first_name, last_name, status)
       VALUES (?, ?, ?, ?, 'invited')`,
      [email, passwordHash, firstName, lastName]
    );
    const userId = result.insertId;

    await conn.execute(
      "INSERT INTO user_company_access (user_id, company_id, branch_id, status) VALUES (?, ?, ?, 'active')",
      [userId, companyId, branchId]
    );
    for (const roleId of roleIds) {
      await conn.execute(
        "INSERT INTO user_roles (user_id, role_id, company_id, branch_id, status) VALUES (?, ?, ?, ?, 'active')",
        [userId, roleId, companyId, branchId]
      );
    }
    await conn.commit();
    createdId = userId;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  // Sent after the commit: a slow or failed email must not undo the account.
  const handover = await sendInvitation(db, { userId: createdId, companyId, invitedBy: req.context.userId ?? null });

  await recordAudit(req, {
    module: "admin", action: "user.invite", entityType: "user", entityId: createdId,
    summary: `Invited ${email}`, metadata: { roleIds, delivery: handover.delivery },
  });

  res.set("Cache-Control", "no-store");
  return res.status(201).json({
    success: true,
    data: { userId: createdId, email, ...handover, expiresAt: handover.expiresAt.toISOString() },
  });
}

/* PATCH /api/v1/admin/users/:id */
export async function updateUser(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);

  const [existing] = await db.execute(
    `SELECT u.user_id, u.status FROM users u
     JOIN user_company_access uca ON uca.user_id = u.user_id AND uca.company_id = ?
     WHERE u.user_id = ? LIMIT 1`,
    [companyId, id]
  );
  if (!existing.length) {
    return res.status(404).json({ success: false, message: "User not found." });
  }
  // An invited account becomes active only by accepting, with a password its
  // owner chose; switching it on here would leave an account nobody can use.
  if (existing[0].status === "invited" && (req.body.status === "active" || req.body.password)) {
    return res.status(409).json({
      success: false,
      message: "This person hasn't accepted their invitation yet. Resend the invitation instead.",
    });
  }

  // Last-administrator guard: don't let the company lose its final admin.
  if (req.body.status === "inactive") {
    const admins = await companyAdminUserIds(db, companyId);
    if (admins.has(id) && admins.size === 1) {
      return res.status(409).json({
        success: false,
        message: "This is the company's last active administrator and can't be deactivated.",
      });
    }
  }

  const fields = [];
  const params = [];

  if (req.body.firstName !== undefined) {
    fields.push("first_name = ?");
    params.push(String(req.body.firstName).trim());
  }
  if (req.body.lastName !== undefined) {
    fields.push("last_name = ?");
    params.push(String(req.body.lastName).trim());
  }
  if (req.body.email !== undefined) {
    const email = String(req.body.email).trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }
    const [dupe] = await db.execute(
      "SELECT user_id FROM users WHERE email = ? AND user_id <> ? LIMIT 1",
      [email, id]
    );
    if (dupe.length) {
      return res.status(409).json({ success: false, message: "Email already registered to another user." });
    }
    fields.push("email = ?");
    params.push(email);
  }
  if (req.body.status === "active" || req.body.status === "inactive") {
    fields.push("status = ?");
    params.push(req.body.status);
  }
  if (req.body.password) {
    if (String(req.body.password).length < MIN_PASSWORD) {
      return res.status(400).json({ success: false, message: `Password must be at least ${MIN_PASSWORD} characters.` });
    }
    const passwordIssue = passwordProblem(String(req.body.password), {
      email: req.body.email === undefined ? "" : String(req.body.email).trim().toLowerCase(),
    });
    if (passwordIssue) return res.status(400).json({ success: false, message: passwordIssue });
    fields.push("password_hash = ?");
    params.push(await bcrypt.hash(String(req.body.password), 10));
    fields.push("must_change_password = TRUE");
    fields.push("temporary_password_expires_at = ?");
    params.push(new Date(Date.now() + TEMPORARY_PASSWORD_HOURS * 60 * 60 * 1000));
  }

  if (!fields.length) {
    return res.status(400).json({ success: false, message: "Nothing to update." });
  }

  params.push(id);
  await db.execute(`UPDATE users SET ${fields.join(", ")} WHERE user_id = ?`, params);

  await recordAudit(req, {
    module: "admin", action: "user.update", entityType: "user", entityId: id,
    summary: `Updated user #${id}`,
    metadata: { fields: Object.keys(req.body).filter((k) => k !== "password") },
  });

  res.json({ success: true });
}

/* POST /api/v1/admin/users/:id/temporary-password */
export async function issueTemporaryPassword(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  if (id === req.context.userId) {
    return res.status(409).json({
      success: false,
      message: "Use My Profile to change your own password. Temporary access is for another user.",
    });
  }
  const [rows] = await db.execute(
    `SELECT u.user_id, u.email, u.first_name, u.last_name, u.status
     FROM users u
     JOIN user_company_access uca
       ON uca.user_id = u.user_id AND uca.company_id = ? AND uca.status = 'active'
     WHERE u.user_id = ? LIMIT 1`,
    [companyId, id]
  );
  const user = rows[0];
  if (!user) return res.status(404).json({ success: false, message: "User not found." });
  if (user.status !== "active") {
    return res.status(409).json({ success: false, message: "Activate this user before issuing temporary access." });
  }

  const password = generateTemporaryPassword();
  const hash = await bcrypt.hash(password, 10);
  const expiresAt = new Date(Date.now() + TEMPORARY_PASSWORD_HOURS * 60 * 60 * 1000);
  await db.execute(
    `UPDATE users
     SET password_hash = ?, must_change_password = TRUE, temporary_password_expires_at = ?
     WHERE user_id = ?`,
    [hash, expiresAt, id]
  );

  const handover = await deliverTemporaryPassword({
    to: user.email,
    name: user.first_name,
    password,
    expiresAt,
  });

  await recordAudit(req, {
    module: "admin",
    action: "user.temporary_access.issue",
    entityType: "user",
    entityId: id,
    summary: `Issued new temporary access for ${user.email}`,
    metadata: { expiresAt: expiresAt.toISOString(), delivery: handover.delivery },
  });

  res.set("Cache-Control", "no-store");
  return res.json({
    success: true,
    data: {
      userId: id,
      email: user.email,
      ...handover,
      expiresAt: expiresAt.toISOString(),
    },
  });
}

/*
 * Every place a user id is written down as history. A person referenced
 * anywhere here has worked in the system, so their account is kept for the
 * record (deactivated, not deleted): deleting it would leave trips, money and
 * stock pointing at nobody.
 */
const USER_HISTORY = [
  ["trip_tickets", ["created_by", "submitted_by", "approved_by", "rejected_by"]],
  ["trip_assignments", ["assigned_by"]],
  ["trip_status_history", ["changed_by"]],
  ["trip_messages", ["sender_user_id"]],
  ["trip_pod", ["received_by"]],
  ["trip_expenses", ["created_by", "reviewed_by"]],
  ["approval_actions", ["acted_by"]],
  ["operational_exceptions", ["acknowledged_by", "resolved_by"]],
  ["expense_vouchers", ["created_by", "submitted_by", "approved_by"]],
  ["expense_attachments", ["uploaded_by_user_id"]],
  ["invoices", ["created_by"]],
  ["journal_entries", ["created_by", "posted_by"]],
  ["bir_records", ["created_by"]],
  ["branch_transfers", ["requested_by", "approved_by"]],
  ["stock_movements", ["requested_by", "approved_by"]],
  ["cargo_events", ["handled_by"]],
  ["vehicle_maintenance", ["created_by"]],
  ["maintenance_attachments", ["uploaded_by_user_id"]],
  ["compliance_documents", ["created_by", "file_uploaded_by"]],
  ["vehicle_type_photos", ["uploaded_by"]],
  ["saved_places", ["created_by"]],
  ["companies", ["suspended_by"]],
  ["company_settings", ["updated_by"]],
];

async function hasHistory(runner, userId) {
  const checks = USER_HISTORY.flatMap(([table, columns]) =>
    columns.map((column) => `EXISTS(SELECT 1 FROM ${table} WHERE ${column} = ?)`)
  );
  const [[row]] = await runner.execute(
    `SELECT (${checks.join(" OR ")}) AS used`,
    checks.map(() => userId)
  );
  return Boolean(Number(row.used));
}

/*
 * DELETE /api/v1/admin/users/:id
 *
 * Permanent, so only for accounts that never did anything: an invitation
 * nobody accepted, or an account made by mistake. Anyone with history is kept
 * and should be deactivated instead. The audit log keeps the record of who
 * was deleted and by whom.
 */
export async function deleteUser(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);

  if (id === req.context.userId) {
    return res.status(409).json({ success: false, message: "You can't delete your own account." });
  }

  const [[user]] = await db.execute(
    `SELECT u.user_id, u.email, u.first_name, u.last_name, u.status FROM users u
     JOIN user_company_access uca ON uca.user_id = u.user_id AND uca.company_id = ?
     WHERE u.user_id = ? LIMIT 1`,
    [companyId, id]
  );
  if (!user) return res.status(404).json({ success: false, message: "User not found." });

  if (user.status === "active") {
    return res.status(409).json({
      success: false,
      message: "Deactivate this user first. Only inactive or invited accounts can be deleted.",
    });
  }

  const [[elsewhere]] = await db.execute(
    "SELECT COUNT(*) AS n FROM user_company_access WHERE user_id = ? AND company_id <> ?",
    [id, companyId]
  );
  if (Number(elsewhere.n) > 0) {
    return res.status(409).json({
      success: false,
      message: "This person also has access to another company, so the account can't be deleted from here.",
    });
  }

  if (await hasHistory(db, id)) {
    return res.status(409).json({
      success: false,
      code: "USER_HAS_HISTORY",
      message: "This user has trips, approvals or other records in Trackify, so the account is kept for the record. It stays deactivated and can't sign in.",
    });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("DELETE FROM user_roles WHERE user_id = ?", [id]);
    await conn.execute("DELETE FROM user_company_access WHERE user_id = ?", [id]);
    await conn.execute("DELETE FROM agreement_acceptances WHERE user_id = ?", [id]);
    // Reset links, alert mutes and invitations go with it (ON DELETE CASCADE).
    await conn.execute("DELETE FROM users WHERE user_id = ?", [id]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  await recordAudit(req, {
    module: "admin", action: "user.delete", entityType: "user", entityId: id,
    summary: `Permanently deleted ${user.status === "invited" ? "the invitation for" : "user"} ${user.email}`,
    metadata: { email: user.email, name: `${user.first_name} ${user.last_name}`.trim(), status: user.status },
  });

  return res.json({ success: true, message: "User deleted." });
}

/*
 * POST /api/v1/admin/users/:id/invitation
 *
 * A fresh invitation for somebody who has not accepted yet — the old link was
 * lost, expired, or went to a mistyped inbox (fix the email first, then
 * resend). The previous link stops working at once.
 */
export async function resendInvitation(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);

  const [[user]] = await db.execute(
    `SELECT u.user_id, u.email, u.status FROM users u
     JOIN user_company_access uca ON uca.user_id = u.user_id AND uca.company_id = ?
     WHERE u.user_id = ? LIMIT 1`,
    [companyId, id]
  );
  if (!user) return res.status(404).json({ success: false, message: "User not found." });
  if (user.status !== "invited") {
    return res.status(409).json({
      success: false,
      message: "This person has already set up their account. Use temporary access or a password reset instead.",
    });
  }

  const handover = await sendInvitation(db, { userId: id, companyId, invitedBy: req.context.userId ?? null });

  await recordAudit(req, {
    module: "admin", action: "user.invite.resend", entityType: "user", entityId: id,
    summary: `Resent the invitation to ${user.email}`, metadata: { delivery: handover.delivery },
  });

  res.set("Cache-Control", "no-store");
  return res.json({
    success: true,
    data: { userId: id, email: user.email, ...handover, expiresAt: handover.expiresAt.toISOString() },
  });
}

/* PUT /api/v1/admin/users/:id/roles — replace the user's roles for the acting company */
export async function setUserRoles(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const roleIds = Array.isArray(req.body.roleIds)
    ? [...new Set(req.body.roleIds.map(Number).filter(Boolean))]
    : [];

  const [existing] = await db.execute(
    `SELECT u.user_id FROM users u
     JOIN user_company_access uca ON uca.user_id = u.user_id AND uca.company_id = ?
     WHERE u.user_id = ? LIMIT 1`,
    [companyId, id]
  );
  if (!existing.length) {
    return res.status(404).json({ success: false, message: "User not found." });
  }

  if (roleIds.length) {
    const ph = roleIds.map(() => "?").join(", ");
    const [valid] = await db.execute(
      `SELECT role_id FROM roles WHERE company_id = ? AND role_id IN (${ph})`,
      [companyId, ...roleIds]
    );
    if (valid.length !== roleIds.length) {
      return res.status(400).json({ success: false, message: "One or more roles are invalid for this company." });
    }
    const err = await checkRoleAssignmentScope(req, roleIds);
    if (err) return res.status(err.status).json({ success: false, message: err.message });
  }

  // Last-administrator guard: if this user is currently the only admin and the
  // new role set would strip their admin capability, refuse.
  const admins = await companyAdminUserIds(db, companyId);
  if (admins.has(id) && admins.size === 1) {
    const stillAdmin = await rolesConferAdmin(db, roleIds);
    if (!stillAdmin) {
      return res.status(409).json({
        success: false,
        message: "This is the company's last active administrator — leave them an administrator role.",
      });
    }
  }

  const branchScopes = await userRoleAssignmentScopes(db, id, companyId);
  if (!branchScopes.length) {
    return res.status(409).json({
      success: false,
      message: "The user has no active company or branch access for these roles.",
    });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("DELETE FROM user_roles WHERE user_id = ? AND company_id = ?", [id, companyId]);
    for (const roleId of roleIds) {
      for (const branchId of branchScopes) {
        await conn.execute(
          "INSERT INTO user_roles (user_id, role_id, company_id, branch_id, status) VALUES (?, ?, ?, ?, 'active')",
          [id, roleId, companyId, branchId]
        );
      }
    }
    await conn.commit();

    await recordAudit(req, {
      module: "admin", action: "user.roles.set", entityType: "user", entityId: id,
      summary: `Set ${roleIds.length} role(s) for user #${id}`,
      metadata: { roleIds, branchScopes },
    });

    res.json({ success: true });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * The company an access grant targets. A System Administrator may name any
 * company; everyone else is locked to their current operating company.
 */
function targetCompanyId(req, requested) {
  const asked = Number(requested);
  if (req.context.isSystemAdmin && asked > 0) return asked;
  return req.context.companyId;
}

/* POST /api/v1/admin/users/:id/access — grant (or re-activate) a company/branch access record */
export async function grantUserAccess(req, res) {
  const userId = Number(req.params.id);
  const companyId = targetCompanyId(req, req.body.companyId);
  const branchId = req.body.branchId ? Number(req.body.branchId) : null;
  const effectiveFrom = req.body.effectiveFrom || null;
  const effectiveTo = req.body.effectiveTo || null;

  if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
    return res.status(400).json({ success: false, message: "The access end date must be after the start date." });
  }

  const [userRows] = await db.execute("SELECT user_id FROM users WHERE user_id = ? LIMIT 1", [userId]);
  if (!userRows.length) {
    return res.status(404).json({ success: false, message: "User not found." });
  }

  if (branchId) {
    const [branch] = await db.execute(
      "SELECT branch_id FROM branches WHERE branch_id = ? AND company_id = ? LIMIT 1",
      [branchId, companyId]
    );
    if (!branch.length) {
      return res.status(400).json({ success: false, message: "Invalid branch for this company." });
    }
  }

  // NULL doesn't collide with itself under the table's unique key, so a
  // company-wide (branch_id IS NULL) grant needs its own lookup rather than
  // relying on ON DUPLICATE KEY to find the existing row.
  const [existing] = branchId
    ? await db.execute(
        "SELECT access_id FROM user_company_access WHERE user_id = ? AND company_id = ? AND branch_id = ? LIMIT 1",
        [userId, companyId, branchId]
      )
    : await db.execute(
        "SELECT access_id FROM user_company_access WHERE user_id = ? AND company_id = ? AND branch_id IS NULL LIMIT 1",
        [userId, companyId]
      );

  if (existing.length) {
    await db.execute(
      "UPDATE user_company_access SET status = 'active', effective_from = ?, effective_to = ? WHERE access_id = ?",
      [effectiveFrom, effectiveTo, existing[0].access_id]
    );
  } else {
    await db.execute(
      `INSERT INTO user_company_access (user_id, company_id, branch_id, status, effective_from, effective_to)
       VALUES (?, ?, ?, 'active', ?, ?)`,
      [userId, companyId, branchId, effectiveFrom, effectiveTo]
    );
  }

  await recordAudit(req, {
    module: "admin", action: "user.access.grant", entityType: "user", entityId: userId,
    summary: `Granted access for user #${userId}`,
    metadata: { companyId, branchId, effectiveFrom, effectiveTo },
  });

  res.status(201).json({ success: true });
}

/* PATCH /api/v1/admin/users/:id/access/:accessId — activate or deactivate one access record in place */
export async function setUserAccessStatus(req, res) {
  const userId = Number(req.params.id);
  const accessId = Number(req.params.accessId);
  const { companyId, isSystemAdmin } = req.context;
  const nextStatus =
    req.body.status === "active" ? "active" : req.body.status === "inactive" ? "inactive" : null;

  if (!nextStatus) {
    return res.status(400).json({ success: false, message: "status must be 'active' or 'inactive'." });
  }

  const [rows] = await db.execute(
    "SELECT access_id, company_id, status FROM user_company_access WHERE access_id = ? AND user_id = ? LIMIT 1",
    [accessId, userId]
  );
  if (!rows.length || (!isSystemAdmin && rows[0].company_id !== companyId)) {
    return res.status(404).json({ success: false, message: "Access record not found." });
  }
  if (rows[0].status === nextStatus) {
    return res.json({ success: true }); // already in the requested state
  }

  if (nextStatus === "inactive") {
    const [activeRows] = await db.execute(
      "SELECT COUNT(*) AS n FROM user_company_access WHERE user_id = ? AND status = 'active'",
      [userId]
    );
    if (activeRows[0].n <= 1) {
      return res.status(409).json({
        success: false,
        message: "This is the user's only active access and can't be revoked. Deactivate the user instead.",
      });
    }
  }

  await db.execute("UPDATE user_company_access SET status = ? WHERE access_id = ?", [nextStatus, accessId]);

  await recordAudit(req, {
    module: "admin",
    action: nextStatus === "active" ? "user.access.reactivate" : "user.access.revoke",
    entityType: "user", entityId: userId,
    summary: `${nextStatus === "active" ? "Reactivated" : "Revoked"} access #${accessId} for user #${userId}`,
  });

  res.json({ success: true });
}
