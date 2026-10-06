import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import {
  DEFAULT_TERM_MONTHS,
  enforcementEnabled,
  findLicense,
  issueLicense,
  latestReminders,
  listLicenses,
  renewedExpiry,
  serializeLicense,
} from "../../shared/license.js";

const MAX_TERM_MONTHS = 120;

function systemAdminOnly(req, res, action) {
  if (req.context.isSystemAdmin) return true;
  res.status(403).json({ success: false, message: `Only a System Administrator can ${action}.` });
  return false;
}

function parseTerm(value, { allowNone = false } = {}) {
  if (value === undefined || value === null || value === "") return DEFAULT_TERM_MONTHS;
  const months = Number(value);
  if (!Number.isInteger(months) || months < (allowNone ? 0 : 1) || months > MAX_TERM_MONTHS) return null;
  return months;
}

async function companyOr404(id, res) {
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, message: "Invalid company." });
    return null;
  }
  const [rows] = await db.execute(
    "SELECT company_id, company_name, company_code FROM companies WHERE company_id = ? LIMIT 1",
    [id]
  );
  if (!rows.length) {
    res.status(404).json({ success: false, message: "Company not found." });
    return null;
  }
  return rows[0];
}

/* GET /api/v1/admin/license — the license of the company you are operating in. */
export async function getMyLicense(req, res) {
  const row = await findLicense(db, req.context.companyId);
  const reminders = row ? await latestReminders(db, [row.license_id]) : new Map();
  res.set("Cache-Control", "no-store");
  res.json({
    success: true,
    data: {
      ...serializeLicense(row, new Date(), row ? reminders.get(row.license_id) ?? null : undefined, {
        withRecipients: req.context.isSystemAdmin,
      }),
      enforced: enforcementEnabled(),
    },
  });
}

/* GET /api/v1/admin/licenses — every client's license. System Administrator only. */
export async function listAllLicenses(req, res) {
  if (!systemAdminOnly(req, res, "view every client's license")) return;
  const rows = await listLicenses(db);
  const reminders = await latestReminders(db, rows.map((row) => row.license_id));
  const now = new Date();
  res.json({
    success: true,
    data: rows.map((row) => serializeLicense(row, now, reminders.get(row.license_id) ?? null, { withRecipients: true })),
    enforced: enforcementEnabled(),
  });
}

/* POST /api/v1/admin/companies/:id/license — issue to a company that has none. */
export async function issueCompanyLicense(req, res) {
  if (!systemAdminOnly(req, res, "issue a license")) return;
  const company = await companyOr404(Number(req.params.id), res);
  if (!company) return;
  const termMonths = parseTerm(req.body.termMonths, { allowNone: true });
  if (termMonths === null) {
    return res.status(400).json({ success: false, message: `The term must be a whole number of months, 1 to ${MAX_TERM_MONTHS}.` });
  }

  if (await findLicense(db, company.company_id)) {
    return res.status(409).json({ success: false, message: "This client already has a license. Renew it instead." });
  }
  let issued;
  try {
    issued = await issueLicense(db, {
      companyId: company.company_id,
      companyCode: company.company_code,
      issuedBy: req.context.userId ?? null,
      termMonths,
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "This client already has a license. Renew it instead." });
    }
    throw error;
  }

  await recordAudit(req, {
    module: "admin",
    action: "license.issue",
    entityType: "company",
    entityId: company.company_id,
    summary: `Issued license ${issued.licenseNumber} to ${company.company_name}`,
    metadata: { licenseNumber: issued.licenseNumber, termMonths },
  });
  res.status(201).json({ success: true, data: serializeLicense(await findLicense(db, company.company_id)) });
}

/* POST /api/v1/admin/companies/:id/license/renew — extend by a term. */
export async function renewCompanyLicense(req, res) {
  if (!systemAdminOnly(req, res, "renew a license")) return;
  const company = await companyOr404(Number(req.params.id), res);
  if (!company) return;
  const termMonths = parseTerm(req.body.termMonths);
  if (termMonths === null) {
    return res.status(400).json({ success: false, message: `The term must be a whole number of months, 1 to ${MAX_TERM_MONTHS}.` });
  }

  const license = await findLicense(db, company.company_id);
  if (!license) return res.status(404).json({ success: false, message: "This client has no license to renew." });
  if (!license.expires_at) {
    return res.status(409).json({ success: false, message: "This license never expires, so there is nothing to renew." });
  }
  if (license.status === "revoked") {
    return res.status(409).json({ success: false, message: "Reinstate this license before renewing it." });
  }

  const expiresAt = renewedExpiry(license.expires_at, termMonths);
  // Only if nobody changed it since it was read: two administrators renewing at
  // once must not both be told "renewed" while one of them is silently lost, and
  // a revoke that lands in between must not be undone by a stale renewal.
  const [updated] = await db.execute(
    "UPDATE licenses SET expires_at = ? WHERE license_id = ? AND status = 'active' AND expires_at <=> ?",
    [expiresAt, license.license_id, license.expires_at]
  );
  if (!updated.affectedRows) {
    return res.status(409).json({ success: false, message: "This license was changed by someone else. Reload and try again." });
  }

  await recordAudit(req, {
    module: "admin",
    action: "license.renew",
    entityType: "company",
    entityId: company.company_id,
    summary: `Renewed license ${license.license_number} for ${company.company_name}`,
    metadata: { termMonths, previousExpiresAt: license.expires_at, expiresAt },
  });
  res.json({ success: true, data: serializeLicense(await findLicense(db, company.company_id)) });
}

/* POST /api/v1/admin/companies/:id/license/revoke */
export async function revokeCompanyLicense(req, res) {
  if (!systemAdminOnly(req, res, "revoke a license")) return;
  const company = await companyOr404(Number(req.params.id), res);
  if (!company) return;
  const reason = String(req.body.reason || "").trim();
  if (reason.length < 10 || reason.length > 500) {
    return res.status(400).json({ success: false, message: "A revocation reason between 10 and 500 characters is required." });
  }

  const [result] = await db.execute(
    `UPDATE licenses
        SET status = 'revoked', revoked_at = NOW(), revoked_reason = ?, revoked_by = ?
      WHERE company_id = ? AND status = 'active'`,
    [reason, req.context.userId ?? null, company.company_id]
  );
  if (!result.affectedRows) {
    const existing = await findLicense(db, company.company_id);
    return res.status(existing ? 409 : 404).json({
      success: false,
      message: existing ? "This license is already revoked." : "This client has no license.",
    });
  }

  await recordAudit(req, {
    module: "admin",
    action: "license.revoke",
    entityType: "company",
    entityId: company.company_id,
    summary: `Revoked the license of ${company.company_name}`,
    metadata: { reason },
  });
  res.json({ success: true, data: serializeLicense(await findLicense(db, company.company_id)) });
}

/* POST /api/v1/admin/companies/:id/license/reinstate */
export async function reinstateCompanyLicense(req, res) {
  if (!systemAdminOnly(req, res, "reinstate a license")) return;
  const company = await companyOr404(Number(req.params.id), res);
  if (!company) return;

  const [result] = await db.execute(
    `UPDATE licenses
        SET status = 'active', revoked_at = NULL, revoked_reason = NULL, revoked_by = NULL
      WHERE company_id = ? AND status = 'revoked'`,
    [company.company_id]
  );
  if (!result.affectedRows) {
    const existing = await findLicense(db, company.company_id);
    return res.status(existing ? 409 : 404).json({
      success: false,
      message: existing ? "This license is not revoked." : "This client has no license.",
    });
  }

  await recordAudit(req, {
    module: "admin",
    action: "license.reinstate",
    entityType: "company",
    entityId: company.company_id,
    summary: `Reinstated the license of ${company.company_name}`,
  });
  res.json({ success: true, data: serializeLicense(await findLicense(db, company.company_id)) });
}
