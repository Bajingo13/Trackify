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
            c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM branches b WHERE b.company_id = c.company_id) AS branch_count
     FROM companies c
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
    `SELECT company_id, company_name, company_code, status, created_at, updated_at
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
  if (req.body.status === "active" || req.body.status === "inactive") {
    // Deactivating a whole company is a System Administrator action.
    if (!req.context.isSystemAdmin && req.body.status === "inactive") {
      return res.status(403).json({
        success: false,
        message: "Only a System Administrator can deactivate a company.",
      });
    }
    fields.push("status = ?");
    params.push(req.body.status);
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
