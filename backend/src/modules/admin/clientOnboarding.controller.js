import crypto from "node:crypto";
import bcrypt from "bcrypt";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { provisionCompanyRoles, syncPermissionCatalog } from "../../shared/provisionRoles.js";
import { deliverTemporaryPassword } from "../../shared/temporaryAccess.js";

const TEMPORARY_PASSWORD_HOURS = 72;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^[A-Z0-9][A-Z0-9_-]*$/;

function temporaryPassword() {
  // The fixed prefix supplies mixed character classes; randomBytes supplies
  // the entropy. Emailed or returned once, and never stored as plain text.
  return `Tfy!${crypto.randomBytes(12).toString("base64url")}`;
}

export async function createClient(req, res) {
  if (!req.context.isSystemAdmin) {
    return res.status(403).json({
      success: false,
      message: "Only a System Administrator can set up a new client.",
    });
  }

  const companyName = String(req.body.companyName || "").trim();
  const companyCode = String(req.body.companyCode || "").trim().toUpperCase();
  const branchName = String(req.body.branchName || "").trim();
  const branchCode = String(req.body.branchCode || "").trim().toUpperCase();
  const prefix = String(req.body.prefix || branchCode).trim().toUpperCase();
  const firstName = String(req.body.firstName || "").trim();
  const lastName = String(req.body.lastName || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();

  if (!companyName || !companyCode || !branchName || !branchCode || !firstName || !lastName || !email) {
    return res.status(400).json({ success: false, message: "Complete every required setup field." });
  }
  if (!CODE.test(companyCode) || !CODE.test(branchCode) || companyCode.length > 50 || branchCode.length > 50) {
    return res.status(400).json({ success: false, message: "Company and branch codes may use letters, numbers, hyphens, and underscores only." });
  }
  if (prefix.length > 10) {
    return res.status(400).json({ success: false, message: "The branch prefix must be 10 characters or fewer." });
  }
  if (!EMAIL.test(email)) {
    return res.status(400).json({ success: false, message: "Enter a valid administrator email address." });
  }

  const [duplicates] = await db.execute(
    `SELECT
       EXISTS(SELECT 1 FROM companies WHERE company_code = ?) AS company_exists,
       EXISTS(SELECT 1 FROM users WHERE email = ?) AS email_exists`,
    [companyCode, email]
  );
  if (duplicates[0]?.company_exists) {
    return res.status(409).json({ success: false, message: "Company code already exists." });
  }
  if (duplicates[0]?.email_exists) {
    return res.status(409).json({ success: false, message: "Administrator email is already registered." });
  }

  const plainPassword = temporaryPassword();
  const passwordHash = await bcrypt.hash(plainPassword, 10);
  const expiresAt = new Date(Date.now() + TEMPORARY_PASSWORD_HOURS * 60 * 60 * 1000);
  const conn = await db.getConnection();
  let companyId;
  let branchId;
  let userId;

  try {
    await conn.beginTransaction();
    const [company] = await conn.execute(
      "INSERT INTO companies (company_name, company_code, status) VALUES (?, ?, 'active')",
      [companyName, companyCode]
    );
    companyId = company.insertId;

    await syncPermissionCatalog(conn);
    await provisionCompanyRoles(conn, companyId);

    const [branch] = await conn.execute(
      `INSERT INTO branches (company_id, branch_name, branch_code, prefix, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [companyId, branchName, branchCode, prefix]
    );
    branchId = branch.insertId;

    const [roles] = await conn.execute(
      `SELECT role_id FROM roles
       WHERE company_id = ? AND role_name = 'Company Administrator' AND status = 'active'
       LIMIT 1`,
      [companyId]
    );
    if (!roles[0]?.role_id) throw new Error("Company Administrator role was not provisioned.");

    const [user] = await conn.execute(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, status,
          must_change_password, temporary_password_expires_at)
       VALUES (?, ?, ?, ?, 'active', TRUE, ?)`,
      [email, passwordHash, firstName, lastName, expiresAt]
    );
    userId = user.insertId;

    // NULL branch means company-wide access. loadAuthProfile expands this into
    // the company's current and future branches.
    await conn.execute(
      `INSERT INTO user_company_access (user_id, company_id, branch_id, status)
       VALUES (?, ?, NULL, 'active')`,
      [userId, companyId]
    );
    await conn.execute(
      `INSERT INTO user_roles (user_id, role_id, company_id, branch_id, status)
       VALUES (?, ?, ?, NULL, 'active')`,
      [userId, roles[0].role_id, companyId]
    );

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "That company code or administrator email is already in use." });
    }
    throw error;
  } finally {
    conn.release();
  }

  const handover = await deliverTemporaryPassword({
    to: email,
    name: firstName,
    password: plainPassword,
    expiresAt,
    firstAccount: true,
  });

  const originalContext = req.context;
  req.context = { ...originalContext, companyId, branchId };
  await recordAudit(req, {
    module: "admin",
    action: "client.onboard",
    entityType: "company",
    entityId: companyId,
    summary: `Set up ${companyName}, its first branch, and administrator ${email}`,
    metadata: {
      branchId,
      administratorUserId: userId,
      temporaryPasswordHours: TEMPORARY_PASSWORD_HOURS,
      temporaryPasswordDelivery: handover.delivery,
    },
  });
  req.context = originalContext;

  res.set("Cache-Control", "no-store");
  return res.status(201).json({
    success: true,
    data: {
      company: { companyId, companyName, companyCode },
      branch: { branchId, branchName, branchCode, prefix },
      administrator: { userId, firstName, lastName, email },
      ...handover,
      expiresAt: expiresAt.toISOString(),
    },
  });
}
