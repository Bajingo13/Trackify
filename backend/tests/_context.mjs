/**
 * Which company/branch the end-to-end suites operate in.
 *
 * Two things make this worth a shared helper rather than an `access[0]` in
 * every suite:
 *
 *   1. Every /api/v1 route requires BOTH a company and a branch. A System
 *      Administrator's access list leads with a company-wide row whose branch
 *      is null, so `access[0]` sends no branch and every call comes back 400
 *      — "Company and branch operating context are required."
 *   2. The seeded fixtures are not spread evenly — every demo trip belongs to
 *      one branch. Picking whichever branch happens to sort first lands the
 *      suite in a branch with no trips, where the API correctly answers 404
 *      and the suite reports a failure that says nothing about the product.
 *
 * So: prefer the branch the fixtures live in, then any branch at all, then
 * whatever came first. Override with TRACKIFY_TEST_BRANCH (a branch code).
 */

export const FIXTURE_BRANCH_CODE = process.env.TRACKIFY_TEST_BRANCH || "DVO";

/* Used only when a suite has no database pool of its own — the login payload
 * carries branch names but not codes, so the code is matched by its name. */
const NAME_BY_CODE = {
  DVO: "Davao",
  CEB: "Cebu",
  GEN: "General Santos",
  MKT: "Makati",
};

/**
 * @param access the `data.access` array from a staff login response
 * @param db     optional mysql pool; when given, the branch code is resolved
 *               against the branches table rather than matched by name
 * @returns the access entry to send as X-Company-Id / X-Branch-Id
 */
export async function operatingScope(access, db = null) {
  const list = Array.isArray(access) ? access : [];
  let preferred = null;

  if (db) {
    try {
      const [[row]] = await db.execute(
        `SELECT branch_id FROM branches WHERE branch_code = ? AND status = 'active' LIMIT 1`,
        [FIXTURE_BRANCH_CODE],
      );
      if (row) {
        preferred = list.find(
          (a) => Number(a.branch_id) === Number(row.branch_id),
        );
      }
    } catch {
      /* fall through to the name match below */
    }
  }

  if (!preferred) {
    const name = NAME_BY_CODE[FIXTURE_BRANCH_CODE];
    if (name) {
      preferred = list.find((a) =>
        String(a.branch_name || "")
          .toLowerCase()
          .startsWith(name.toLowerCase()),
      );
    }
  }

  return preferred || list.find((a) => a.branch_id) || list[0] || {};
}

/** The headers every staff-side suite sends. */
export async function staffHeaders(loginJson, db = null) {
  const a = await operatingScope(loginJson?.data?.access, db);
  return {
    Authorization: `Bearer ${loginJson?.data?.token}`,
    "X-Company-Id": String(a.company_id ?? ""),
    "X-Branch-Id": String(a.branch_id ?? ""),
    "Content-Type": "application/json",
  };
}
