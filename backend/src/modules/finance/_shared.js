export const STR = (v) => (v === "" || v == null ? null : String(v).trim());
export const NUM = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
export const money = (v) => Math.round(NUM(v) * 100) / 100;

/**
 * Next document number in the form PREFIX-YYYY-NNNN, scoped to a company and
 * the current year. `runner` is a connection or the pool.
 */
export async function nextDocNo(runner, { table, col, prefix, companyId }) {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const [rows] = await runner.execute(
    `SELECT ${col} c FROM ${table}
       WHERE company_id = ? AND ${col} LIKE ?
       ORDER BY CAST(SUBSTRING_INDEX(${col}, '-', -1) AS UNSIGNED) DESC
       LIMIT 1`,
    [companyId, like]
  );
  const last = rows.length ? Number(String(rows[0].c).split("-").pop()) : 0;
  return `${prefix}-${year}-${String(last + 1).padStart(4, "0")}`;
}

/** Standard list response. */
export const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });
export const fail = (res, code, message) => res.status(code).json({ success: false, message });

/**
 * Parse ?page & ?limit. When `limit` is absent the caller wants everything
 * (reports, pickers) — returns { limit: null }. When present, clamps to
 * [1, 200] and computes offset from `page` (1-based).
 */
export function pageParams(query) {
  if (query.limit == null || query.limit === "") return { limit: null, offset: 0, page: 1 };
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 200);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
}

/**
 * Run a list query with optional pagination. `baseSql` must end right before any
 * ORDER BY; pass ORDER BY separately in `orderSql`. Returns { rows, total }.
 */
export async function runList(db, { selectSql, fromWhereSql, orderSql = "", params, limit, offset }) {
  if (limit == null) {
    const [rows] = await db.execute(`${selectSql} ${fromWhereSql} ${orderSql}`, params);
    return { rows, total: rows.length };
  }
  const [[{ n }]] = await db.execute(`SELECT COUNT(*) n ${fromWhereSql}`, params);
  const [rows] = await db.execute(
    `${selectSql} ${fromWhereSql} ${orderSql} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { rows, total: Number(n) };
}
