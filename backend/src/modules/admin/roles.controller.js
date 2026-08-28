import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { ungrantable } from "../../shared/rbac.js";
import { loadGrantedCodes } from "../auth/auth.service.js";

/** Map a list of permission_id → permission_code. */
async function idsToCodes(ids) {
  if (!ids.length) return [];
  const ph = ids.map(() => "?").join(", ");
  const [rows] = await db.execute(
    `SELECT permission_id, permission_code FROM permissions WHERE permission_id IN (${ph})`,
    ids
  );
  return rows;
}

/**
 * Reject the request if the actor is trying to put permissions on a role that
 * they do not themselves hold (System Administrators bypass this).
 * Returns an error response object, or null if ok.
 */
async function checkGrantScope(req, permissionIds) {
  const rows = await idsToCodes(permissionIds);
  if (rows.length !== permissionIds.length) {
    return { status: 400, message: "One or more permissions are invalid." };
  }
  const requestedCodes = rows.map((r) => r.permission_code);
  const actorCodes = await loadGrantedCodes(
    req.context.userId,
    req.context.companyId,
    req.context.branchId
  );
  const blocked = ungrantable(actorCodes, requestedCodes);
  if (blocked.length) {
    return {
      status: 403,
      message: `You cannot grant permissions you do not hold: ${blocked.join(", ")}`,
    };
  }
  return null;
}

/* GET /api/v1/admin/permissions */
export async function listPermissions(req, res) {
  const [rows] = await db.execute(
    "SELECT permission_id, permission_code, description FROM permissions ORDER BY permission_code ASC"
  );
  res.json({ success: true, data: rows });
}

/* GET /api/v1/admin/roles */
export async function listRoles(req, res) {
  const { companyId } = req.context;
  const [rows] = await db.execute(
    `SELECT r.role_id, r.company_id, r.role_name, r.is_system, r.description, r.status,
            (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.role_id) AS permission_count,
            (SELECT COUNT(DISTINCT ur.user_id) FROM user_roles ur WHERE ur.role_id = r.role_id AND ur.status = 'active') AS user_count
     FROM roles r
     WHERE r.company_id = ?
     ORDER BY r.is_system DESC, r.role_name ASC`,
    [companyId]
  );
  res.json({ success: true, data: rows });
}

/* GET /api/v1/admin/roles/:id */
export async function getRole(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);

  const [rows] = await db.execute(
    "SELECT role_id, company_id, role_name, is_system, description, status FROM roles WHERE role_id = ? AND company_id = ? LIMIT 1",
    [id, companyId]
  );
  if (!rows.length) {
    return res.status(404).json({ success: false, message: "Role not found." });
  }

  const [permissions] = await db.execute(
    `SELECT p.permission_id, p.permission_code, p.description
     FROM role_permissions rp
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE rp.role_id = ?
     ORDER BY p.permission_code ASC`,
    [id]
  );

  res.json({ success: true, data: { ...rows[0], permissions } });
}

/* POST /api/v1/admin/roles */
export async function createRole(req, res) {
  const { companyId } = req.context;
  const roleName = String(req.body.roleName || "").trim();
  const permissionIds = Array.isArray(req.body.permissionIds)
    ? [...new Set(req.body.permissionIds.map(Number).filter(Boolean))]
    : [];

  if (!roleName) {
    return res.status(400).json({ success: false, message: "Role name is required." });
  }

  const [dupe] = await db.execute(
    "SELECT role_id FROM roles WHERE company_id = ? AND role_name = ? LIMIT 1",
    [companyId, roleName]
  );
  if (dupe.length) {
    return res.status(409).json({ success: false, message: "A role with that name already exists." });
  }

  if (permissionIds.length) {
    const err = await checkGrantScope(req, permissionIds);
    if (err) return res.status(err.status).json({ success: false, message: err.message });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      "INSERT INTO roles (company_id, role_name, is_system, status) VALUES (?, ?, 0, 'active')",
      [companyId, roleName]
    );
    const roleId = result.insertId;
    for (const pid of permissionIds) {
      await conn.execute(
        "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
        [roleId, pid]
      );
    }
    await conn.commit();

    await recordAudit(req, {
      module: "admin",
      action: "role.create",
      entityType: "role",
      entityId: roleId,
      summary: `Created role ${roleName}`,
      metadata: { permissionIds },
    });

    res.status(201).json({ success: true, data: { roleId } });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/* PATCH /api/v1/admin/roles/:id — rename / status (custom roles only) */
export async function updateRole(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);

  const [existing] = await db.execute(
    "SELECT role_id, is_system FROM roles WHERE role_id = ? AND company_id = ? LIMIT 1",
    [id, companyId]
  );
  if (!existing.length) {
    return res.status(404).json({ success: false, message: "Role not found." });
  }
  if (existing[0].is_system) {
    return res.status(409).json({
      success: false,
      message: "System role templates can't be renamed or deactivated. You can still adjust their permissions.",
    });
  }

  const fields = [];
  const params = [];
  if (req.body.roleName !== undefined) {
    fields.push("role_name = ?");
    params.push(String(req.body.roleName).trim());
  }
  if (req.body.status === "active" || req.body.status === "inactive") {
    fields.push("status = ?");
    params.push(req.body.status);
  }
  if (!fields.length) {
    return res.status(400).json({ success: false, message: "Nothing to update." });
  }

  params.push(id);
  await db.execute(`UPDATE roles SET ${fields.join(", ")} WHERE role_id = ?`, params);

  await recordAudit(req, {
    module: "admin",
    action: "role.update",
    entityType: "role",
    entityId: id,
    summary: `Updated role #${id}`,
    metadata: req.body,
  });

  res.json({ success: true });
}

/* PUT /api/v1/admin/roles/:id/permissions — replace the permission set */
export async function setRolePermissions(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const permissionIds = Array.isArray(req.body.permissionIds)
    ? [...new Set(req.body.permissionIds.map(Number).filter(Boolean))]
    : [];

  const [existing] = await db.execute(
    "SELECT role_id FROM roles WHERE role_id = ? AND company_id = ? LIMIT 1",
    [id, companyId]
  );
  if (!existing.length) {
    return res.status(404).json({ success: false, message: "Role not found." });
  }

  if (permissionIds.length) {
    const err = await checkGrantScope(req, permissionIds);
    if (err) return res.status(err.status).json({ success: false, message: err.message });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("DELETE FROM role_permissions WHERE role_id = ?", [id]);
    for (const pid of permissionIds) {
      await conn.execute(
        "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
        [id, pid]
      );
    }
    await conn.commit();

    await recordAudit(req, {
      module: "admin",
      action: "role.permissions.set",
      entityType: "role",
      entityId: id,
      summary: `Set ${permissionIds.length} permission(s) on role #${id}`,
      metadata: { permissionIds },
    });

    res.json({ success: true });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
