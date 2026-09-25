import db from "../../config/db.js";

/* GET /api/v1/admin/audit-logs */
export async function listAuditLogs(req, res) {
  const { companyId, isSystemAdmin } = req.context;
  const {
    module = "",
    action = "",
    entityType = "",
    search = "",
    from = "",
    to = "",
  } = req.query;
  const userId = req.query.userId ? Number(req.query.userId) : null;

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;

  /*
   * Tenant scoping, and why it is not simply `a.company_id = ?`.
   *
   * Authentication events — sign-ins, refusals, password resets — are recorded
   * before an operating context exists, so they carry no company at all. The
   * first version of this admitted them with `OR a.company_id IS NULL`, so
   * that a company administrator could see their own staff signing in. What it
   * actually did was hand every tenant every OTHER tenant's sign-in trail:
   * email addresses, IP addresses, times, failed attempts and password-reset
   * requests. Verified against a company one minute old with no activity of
   * its own, which was served 25 rows belonging to somebody else.
   *
   * A company-less row is now admitted only when the person it is about
   * belongs to the company asking. That keeps the sign-in trail visible to the
   * company whose staff it describes — including, correctly, both companies
   * for somebody who works for two — and shows it to nobody else.
   *
   * The actor is `user_id` where one was attributed. A failed sign-in has no
   * session yet, so it carries the account it was aimed at in `entity_id`
   * instead; a non-numeric or empty value casts to 0 and matches nobody.
   */
  const params = [companyId, companyId];
  let where = `(
      a.company_id = ?
      OR (
        a.company_id IS NULL
        AND EXISTS (
          SELECT 1 FROM user_company_access uca
           WHERE uca.company_id = ?
             AND uca.status = 'active'
             AND uca.user_id = COALESCE(
                   a.user_id,
                   CASE WHEN a.entity_type = 'user'
                        THEN CAST(NULLIF(a.entity_id, '') AS UNSIGNED) END)
        )
      )
    )`;

  /*
   * An attempt on an address that belongs to no account — someone guessing —
   * belongs to no tenant, and showing it to one would leak what another
   * tenant's staff are being targeted with. It is kept for the operator of the
   * installation, who is the only person with a legitimate view of the whole
   * platform.
   */
  if (isSystemAdmin) {
    where = `(${where} OR (a.company_id IS NULL AND a.user_id IS NULL
      AND (a.entity_id IS NULL OR a.entity_id = '')))`;
  }

  if (module.trim()) {
    where += " AND a.module = ?";
    params.push(module.trim());
  }
  if (action.trim()) {
    where += " AND a.action = ?";
    params.push(action.trim());
  }
  if (entityType.trim()) {
    where += " AND a.entity_type = ?";
    params.push(entityType.trim());
  }
  if (userId) {
    where += " AND a.user_id = ?";
    params.push(userId);
  }
  if (from) {
    where += " AND a.created_at >= ?";
    params.push(from);
  }
  if (to) {
    where += " AND a.created_at <= ?";
    params.push(to);
  }
  if (search.trim()) {
    where += " AND (a.summary LIKE ? OR a.actor_email LIKE ? OR a.action LIKE ?)";
    const v = `%${search.trim()}%`;
    params.push(v, v, v);
  }

  const [countRows] = await db.execute(
    `SELECT COUNT(*) AS total FROM audit_logs a WHERE ${where}`,
    params
  );
  const total = countRows[0].total;

  const [rows] = await db.execute(
    `SELECT a.audit_id, a.module, a.action, a.entity_type, a.entity_id,
            a.summary, a.metadata, a.ip_address, a.created_at,
            a.actor_email,
            COALESCE(a.actor_email, CONCAT(u.first_name, ' ', u.last_name)) AS actor
     FROM audit_logs a
     LEFT JOIN users u ON u.user_id = a.user_id
     WHERE ${where}
     ORDER BY a.created_at DESC, a.audit_id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  res.json({
    success: true,
    data: rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
