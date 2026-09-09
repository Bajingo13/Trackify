import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";

/**
 * The company a branch operation targets. A System Administrator may name any
 * company; everyone else is locked to their current operating company.
 */
function targetCompanyId(req, requested) {
  const asked = Number(requested);
  if (req.context.isSystemAdmin && asked > 0) return asked;
  return req.context.companyId;
}

/** Load a branch only if the caller is allowed to see its company. */
async function loadBranchInScope(req, branchId) {
  const [rows] = await db.execute(
    `SELECT branch_id, company_id, branch_name, branch_code, prefix, status, created_at, updated_at
     FROM branches WHERE branch_id = ? LIMIT 1`,
    [branchId]
  );
  const branch = rows[0];
  if (!branch) return null;
  if (!req.context.isSystemAdmin && branch.company_id !== req.context.companyId) return null;
  return branch;
}

/* GET /api/v1/admin/branches?companyId= */
export async function listBranches(req, res) {
  const companyId = targetCompanyId(req, req.query.companyId);
  const { search = "", status = "" } = req.query;

  const params = [companyId];
  let where = "b.company_id = ?";

  if (search.trim()) {
    where += " AND (b.branch_name LIKE ? OR b.branch_code LIKE ?)";
    const v = `%${search.trim()}%`;
    params.push(v, v);
  }
  if (status === "active" || status === "inactive") {
    where += " AND b.status = ?";
    params.push(status);
  }

  const [rows] = await db.execute(
    `SELECT b.branch_id, b.company_id, b.branch_name, b.branch_code, b.prefix,
            b.status, b.created_at, b.updated_at, c.company_name
     FROM branches b
     JOIN companies c ON c.company_id = b.company_id
     WHERE ${where}
     ORDER BY b.branch_name ASC`,
    params
  );

  res.json({ success: true, data: rows });
}

/* GET /api/v1/admin/branches/:id */
export async function getBranch(req, res) {
  const branch = await loadBranchInScope(req, Number(req.params.id));
  if (!branch) {
    return res.status(404).json({ success: false, message: "Branch not found." });
  }
  res.json({ success: true, data: branch });
}

/* POST /api/v1/admin/branches */
export async function createBranch(req, res) {
  const companyId = targetCompanyId(req, req.body.companyId);
  const branchName = String(req.body.branchName || "").trim();
  const branchCode = String(req.body.branchCode || "").trim().toUpperCase();
  const prefix = req.body.prefix ? String(req.body.prefix).trim().toUpperCase() : branchCode;
  const status = req.body.status === "inactive" ? "inactive" : "active";

  if (!branchName || !branchCode) {
    return res.status(400).json({ success: false, message: "Branch name and code are required." });
  }

  const [company] = await db.execute(
    "SELECT company_id FROM companies WHERE company_id = ? LIMIT 1",
    [companyId]
  );
  if (!company.length) {
    return res.status(400).json({ success: false, message: "Invalid company." });
  }

  const [dupe] = await db.execute(
    "SELECT branch_id FROM branches WHERE company_id = ? AND branch_code = ? LIMIT 1",
    [companyId, branchCode]
  );
  if (dupe.length) {
    return res.status(409).json({ success: false, message: "Branch code already exists for this company." });
  }

  const [result] = await db.execute(
    "INSERT INTO branches (company_id, branch_name, branch_code, prefix, status) VALUES (?, ?, ?, ?, ?)",
    [companyId, branchName, branchCode, prefix, status]
  );

  await recordAudit(req, {
    module: "admin",
    action: "branch.create",
    entityType: "branch",
    entityId: result.insertId,
    summary: `Created branch ${branchName} (${branchCode})`,
  });

  res.status(201).json({ success: true, data: { branchId: result.insertId } });
}

/* PATCH /api/v1/admin/branches/:id */
export async function updateBranch(req, res) {
  const id = Number(req.params.id);
  const branch = await loadBranchInScope(req, id);
  if (!branch) {
    return res.status(404).json({ success: false, message: "Branch not found." });
  }

  const fields = [];
  const params = [];

  if (req.body.companyId !== undefined) {
    const companyId = targetCompanyId(req, req.body.companyId);
    const [company] = await db.execute(
      "SELECT company_id FROM companies WHERE company_id = ? LIMIT 1",
      [companyId]
    );
    if (!company.length) {
      return res.status(400).json({ success: false, message: "Invalid company." });
    }
    fields.push("company_id = ?");
    params.push(companyId);
  }
  if (req.body.branchName !== undefined) {
    fields.push("branch_name = ?");
    params.push(String(req.body.branchName).trim());
  }
  if (req.body.prefix !== undefined) {
    fields.push("prefix = ?");
    params.push(String(req.body.prefix).trim().toUpperCase());
  }
  if (req.body.status === "active" || req.body.status === "inactive") {
    fields.push("status = ?");
    params.push(req.body.status);
  }

  if (!fields.length) {
    return res.status(400).json({ success: false, message: "Nothing to update." });
  }

  params.push(id);
  await db.execute(`UPDATE branches SET ${fields.join(", ")} WHERE branch_id = ?`, params);

  await recordAudit(req, {
    module: "admin",
    action: "branch.update",
    entityType: "branch",
    entityId: id,
    summary: `Updated branch #${id}`,
    metadata: req.body,
  });

  res.json({ success: true });
}
