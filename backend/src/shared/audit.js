import db from "../config/db.js";

/**
 * Write one audit-log entry. Best-effort: a logging failure is swallowed (and
 * console-logged) so it can never break the request that triggered it.
 *
 * @param {import("express").Request} req  the request (for actor + context + IP)
 * @param {object} entry
 * @param {string} entry.module       e.g. "admin", "operations"
 * @param {string} entry.action       e.g. "company.create"
 * @param {string} [entry.entityType] e.g. "company"
 * @param {string|number} [entry.entityId]
 * @param {string} [entry.summary]    human-readable one-liner
 * @param {object} [entry.metadata]   arbitrary JSON detail
 */
export async function recordAudit(req, entry) {
  try {
    const ctx = req.context || {};
    const ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      null;

    await db.execute(
      `INSERT INTO audit_logs
         (company_id, branch_id, user_id, actor_email, module, action,
          entity_type, entity_id, summary, metadata, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ctx.companyId ?? null,
        ctx.branchId ?? null,
        req.user?.userId ?? null,
        req.user?.email ?? null,
        entry.module,
        entry.action,
        entry.entityType ?? null,
        entry.entityId != null ? String(entry.entityId) : null,
        entry.summary ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        ip,
      ]
    );
  } catch (error) {
    console.error(`[audit] failed to record ${entry?.action}: ${error.message}`);
  }
}
