import db from "../../config/db.js";

/* GET /api/v1/admin/audit-logs */
export async function listAuditLogs(req, res) {
  const { companyId } = req.context;
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

  const params = [companyId];
  let where = "(a.company_id = ? OR a.company_id IS NULL)";

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
