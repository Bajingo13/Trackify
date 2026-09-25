import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { syncPermissionCatalog, provisionCompanyRoles } from "../../shared/provisionRoles.js";

/**
 * Companies a non-system-admin is allowed to see — the ones they hold access to.
 * System Administrators see every company.
 */
async function visibleCompanyIds(req) {
  if (req.context.isSystemAdmin) return null; // null = no restriction
  const [rows] = await db.execute(
    "SELECT DISTINCT company_id FROM user_company_access WHERE user_id = ? AND status = 'active'",
    [req.context.userId]
  );
  return rows.map((r) => r.company_id);
}

/* GET /api/v1/admin/companies */
export async function listCompanies(req, res) {
  const { search = "", status = "" } = req.query;
  const ids = await visibleCompanyIds(req);

  const params = [];
  let where = "1=1";

  if (ids !== null) {
    if (!ids.length) return res.json({ success: true, data: [] });
    where += ` AND c.company_id IN (${ids.map(() => "?").join(", ")})`;
    params.push(...ids);
  }
  if (search.trim()) {
    where += " AND (c.company_name LIKE ? OR c.company_code LIKE ?)";
    const v = `%${search.trim()}%`;
    params.push(v, v);
  }
  if (status === "active" || status === "inactive") {
    where += " AND c.status = ?";
    params.push(status);
  }

  const [rows] = await db.execute(
    `SELECT c.company_id, c.company_name, c.company_code, c.status,
            c.suspension_reason, c.suspended_at, c.suspended_by,
            c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM branches b WHERE b.company_id = c.company_id) AS branch_count,
            (SELECT COUNT(*) FROM branches b WHERE b.company_id = c.company_id AND b.status = 'active') AS active_branch_count,
            COALESCE(admins.admin_count, 0) AS admin_count
     FROM companies c
     LEFT JOIN (
       SELECT capable.company_id, COUNT(*) AS admin_count
       FROM (
         SELECT ur.company_id, ur.user_id
         FROM user_roles ur
         JOIN users u ON u.user_id = ur.user_id AND u.status = 'active'
         JOIN roles r ON r.role_id = ur.role_id AND r.status = 'active'
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.permission_id = rp.permission_id
         WHERE ur.status = 'active'
           AND p.permission_code IN ('user.manage', 'role.manage', 'system.admin')
         GROUP BY ur.company_id, ur.user_id
         HAVING MAX(p.permission_code = 'system.admin') = 1
            OR COUNT(DISTINCT CASE WHEN p.permission_code IN ('user.manage', 'role.manage') THEN p.permission_code END) = 2
       ) capable
       GROUP BY capable.company_id
     ) admins ON admins.company_id = c.company_id
     WHERE ${where}
     ORDER BY c.company_name ASC`,
    params
  );

  res.json({ success: true, data: rows });
}

/* GET /api/v1/admin/companies/:id */
export async function getCompany(req, res) {
  const id = Number(req.params.id);
  const ids = await visibleCompanyIds(req);
  if (ids !== null && !ids.includes(id)) {
    return res.status(404).json({ success: false, message: "Company not found." });
  }

  const [rows] = await db.execute(
    `SELECT company_id, company_name, company_code, status,
            suspension_reason, suspended_at, suspended_by, created_at, updated_at
     FROM companies WHERE company_id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) {
    return res.status(404).json({ success: false, message: "Company not found." });
  }
  res.json({ success: true, data: rows[0] });
}

/* POST /api/v1/admin/companies  — System Administrator only */
export async function createCompany(req, res) {
  if (!req.context.isSystemAdmin) {
    return res.status(403).json({
      success: false,
      message: "Only a System Administrator can create companies.",
    });
  }

  const companyName = String(req.body.companyName || "").trim();
  const companyCode = String(req.body.companyCode || "").trim().toUpperCase();
  const status = req.body.status === "inactive" ? "inactive" : "active";

  if (!companyName || !companyCode) {
    return res.status(400).json({ success: false, message: "Company name and code are required." });
  }

  const [dupe] = await db.execute(
    "SELECT company_id FROM companies WHERE company_code = ? LIMIT 1",
    [companyCode]
  );
  if (dupe.length) {
    return res.status(409).json({ success: false, message: "Company code already exists." });
  }

  const [result] = await db.execute(
    "INSERT INTO companies (company_name, company_code, status) VALUES (?, ?, ?)",
    [companyName, companyCode, status]
  );
  const companyId = result.insertId;

  // Seed the standard role templates so the new company is usable immediately.
  await syncPermissionCatalog(db);
  await provisionCompanyRoles(db, companyId);

  await recordAudit(req, {
    module: "admin",
    action: "company.create",
    entityType: "company",
    entityId: companyId,
    summary: `Created company ${companyName} (${companyCode}) and seeded role templates`,
  });

  res.status(201).json({ success: true, data: { companyId } });
}

/* PATCH /api/v1/admin/companies/:id */
export async function updateCompany(req, res) {
  const id = Number(req.params.id);
  const ids = await visibleCompanyIds(req);
  if (ids !== null && !ids.includes(id)) {
    return res.status(404).json({ success: false, message: "Company not found." });
  }

  const [existing] = await db.execute(
    "SELECT company_id FROM companies WHERE company_id = ? LIMIT 1",
    [id]
  );
  if (!existing.length) {
    return res.status(404).json({ success: false, message: "Company not found." });
  }

  const fields = [];
  const params = [];

  if (req.body.companyName !== undefined) {
    fields.push("company_name = ?");
    params.push(String(req.body.companyName).trim());
  }
  if (req.body.status !== undefined) {
    return res.status(400).json({
      success: false,
      message: "Use the suspend or reactivate action to change company access.",
    });
  }

  if (!fields.length) {
    return res.status(400).json({ success: false, message: "Nothing to update." });
  }

  params.push(id);
  await db.execute(`UPDATE companies SET ${fields.join(", ")} WHERE company_id = ?`, params);

  await recordAudit(req, {
    module: "admin",
    action: "company.update",
    entityType: "company",
    entityId: id,
    summary: `Updated company #${id}`,
    metadata: req.body,
  });

  res.json({ success: true });
}

/* POST /api/v1/admin/companies/:id/suspend — System Administrator only */
export async function suspendCompany(req, res) {
  if (!req.context.isSystemAdmin) {
    return res.status(403).json({
      success: false,
      message: "Only a System Administrator can suspend a company.",
    });
  }

  const id = Number(req.params.id);
  const reason = String(req.body.reason || "").trim();
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "Invalid company." });
  }
  if (reason.length < 10 || reason.length > 500) {
    return res.status(400).json({
      success: false,
      message: "A suspension reason between 10 and 500 characters is required.",
    });
  }
  if (id === Number(req.context.companyId)) {
    return res.status(409).json({
      success: false,
      message: "Switch to another active company before suspending this company.",
    });
  }

  const [result] = await db.execute(
    `UPDATE companies
        SET status = 'inactive', suspension_reason = ?, suspended_at = NOW(), suspended_by = ?
      WHERE company_id = ? AND status = 'active'`,
    [reason, req.context.userId, id]
  );
  if (!result.affectedRows) {
    const [existing] = await db.execute(
      "SELECT company_id FROM companies WHERE company_id = ? LIMIT 1",
      [id]
    );
    return res.status(existing.length ? 409 : 404).json({
      success: false,
      message: existing.length ? "Company is already inactive." : "Company not found.",
    });
  }

  await recordAudit(req, {
    module: "admin",
    action: "company.suspend",
    entityType: "company",
    entityId: id,
    summary: `Suspended company #${id}`,
    metadata: { reason },
  });

  res.json({ success: true });
}

/* POST /api/v1/admin/companies/:id/reactivate — System Administrator only */
export async function reactivateCompany(req, res) {
  if (!req.context.isSystemAdmin) {
    return res.status(403).json({
      success: false,
      message: "Only a System Administrator can reactivate a company.",
    });
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "Invalid company." });
  }

  const [result] = await db.execute(
    `UPDATE companies
        SET status = 'active', suspension_reason = NULL, suspended_at = NULL, suspended_by = NULL
      WHERE company_id = ? AND status = 'inactive'`,
    [id]
  );
  if (!result.affectedRows) {
    const [existing] = await db.execute(
      "SELECT company_id FROM companies WHERE company_id = ? LIMIT 1",
      [id]
    );
    return res.status(existing.length ? 409 : 404).json({
      success: false,
      message: existing.length ? "Company is already active." : "Company not found.",
    });
  }

  await recordAudit(req, {
    module: "admin",
    action: "company.reactivate",
    entityType: "company",
    entityId: id,
    summary: `Reactivated company #${id}`,
  });

  res.json({ success: true });
}
