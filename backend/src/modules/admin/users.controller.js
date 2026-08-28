import bcrypt from "bcrypt";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { ungrantable, SYSTEM_ADMIN } from "../../shared/rbac.js";
import { loadGrantedCodes } from "../auth/auth.service.js";
import { companyAdminUserIds, rolesConferAdmin } from "../../shared/companyAdmins.js";

const MIN_PASSWORD = 8;

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

/* GET /api/v1/admin/users */
export async function listUsers(req, res) {
  const { companyId } = req.context;
  const { search = "", status = "" } = req.query;

  const params = [companyId];
  let where = "uca.company_id = ?";

  if (search.trim()) {
    where += " AND (u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)";
    const v = `%${search.trim()}%`;
    params.push(v, v, v);
  }
  if (status === "active" || status === "inactive") {
    where += " AND u.status = ?";
    params.push(status);
  }

  const [rows] = await db.execute(
    `SELECT u.user_id, u.email, u.first_name, u.last_name, u.status,
            u.created_at, u.updated_at,
            GROUP_CONCAT(DISTINCT r.role_name ORDER BY r.role_name SEPARATOR ', ') AS roles
     FROM users u
     JOIN user_company_access uca ON uca.user_id = u.user_id AND uca.status = 'active'
     LEFT JOIN user_roles ur ON ur.user_id = u.user_id AND ur.company_id = uca.company_id AND ur.status = 'active'
     LEFT JOIN roles r ON r.role_id = ur.role_id
     WHERE ${where}
     GROUP BY u.user_id
     ORDER BY u.first_name ASC, u.last_name ASC`,
    params
  );

  res.json({ success: true, data: rows });
}

/* GET /api/v1/admin/users/:id */
export async function getUser(req, res) {
  const { companyId } = req.context;
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

  const [access] = await db.execute(
    `SELECT uca.access_id, uca.company_id, uca.branch_id, uca.status, c.company_name, b.branch_name
     FROM user_company_access uca
     JOIN companies c ON c.company_id = uca.company_id
     LEFT JOIN branches b ON b.branch_id = uca.branch_id
     WHERE uca.user_id = ?`,
    [id]
  );

  const [roles] = await db.execute(
    `SELECT ur.user_role_id, ur.role_id, r.role_name, r.is_system, ur.company_id, ur.branch_id, ur.status
     FROM user_roles ur
     JOIN roles r ON r.role_id = ur.role_id
     WHERE ur.user_id = ?`,
    [id]
  );

  res.json({ success: true, data: { ...rows[0], access, roles } });
}

/* POST /api/v1/admin/users */
export async function createUser(req, res) {
  const { companyId } = req.context;
  const email = String(req.body.email || "").trim().toLowerCase();
  const firstName = String(req.body.firstName || "").trim();
  const lastName = String(req.body.lastName || "").trim();
  const password = String(req.body.password || "");
  const roleIds = Array.isArray(req.body.roleIds)
    ? [...new Set(req.body.roleIds.map(Number).filter(Boolean))]
    : req.body.roleId
    ? [Number(req.body.roleId)]
    : [];
  const branchId = req.body.branchId ? Number(req.body.branchId) : null;

  if (!email || !firstName || !lastName || !password) {
    return res.status(400).json({ success: false, message: "Email, first name, last name and password are required." });
  }
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({ success: false, message: `Password must be at least ${MIN_PASSWORD} characters.` });
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

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await conn.execute(
      "INSERT INTO users (email, password_hash, first_name, last_name, status) VALUES (?, ?, ?, ?, 'active')",
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

    await recordAudit(req, {
      module: "admin", action: "user.create", entityType: "user", entityId: userId,
      summary: `Created user ${email}`, metadata: { roleIds },
    });

    res.status(201).json({ success: true, data: { userId } });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/* PATCH /api/v1/admin/users/:id */
export async function updateUser(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);

  const [existing] = await db.execute(
    `SELECT u.user_id FROM users u
     JOIN user_company_access uca ON uca.user_id = u.user_id AND uca.company_id = ?
     WHERE u.user_id = ? LIMIT 1`,
    [companyId, id]
  );
  if (!existing.length) {
    return res.status(404).json({ success: false, message: "User not found." });
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
  if (req.body.status === "active" || req.body.status === "inactive") {
    fields.push("status = ?");
    params.push(req.body.status);
  }
  if (req.body.password) {
    if (String(req.body.password).length < MIN_PASSWORD) {
      return res.status(400).json({ success: false, message: `Password must be at least ${MIN_PASSWORD} characters.` });
    }
    fields.push("password_hash = ?");
    params.push(await bcrypt.hash(String(req.body.password), 10));
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

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("DELETE FROM user_roles WHERE user_id = ? AND company_id = ?", [id, companyId]);
    for (const roleId of roleIds) {
      await conn.execute(
        "INSERT INTO user_roles (user_id, role_id, company_id, branch_id, status) VALUES (?, ?, ?, NULL, 'active')",
        [id, roleId, companyId]
      );
    }
    await conn.commit();

    await recordAudit(req, {
      module: "admin", action: "user.roles.set", entityType: "user", entityId: id,
      summary: `Set ${roleIds.length} role(s) for user #${id}`, metadata: { roleIds },
    });

    res.json({ success: true });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
