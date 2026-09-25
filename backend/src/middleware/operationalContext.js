import db from "../config/db.js";
import { isSystemAdministrator } from "../shared/accessCheck.js";

async function operationalContext(req, res, next) {
  try {
    const companyId = Number(req.headers["x-company-id"]);
    const branchId = Number(req.headers["x-branch-id"]);

    if (!companyId || !branchId) {
      return res.status(400).json({
        success: false,
        message: "Company and branch operating context are required.",
      });
    }

    const [branchRows] = await db.execute(
      `SELECT b.branch_id
         FROM branches b
         JOIN companies c ON c.company_id = b.company_id AND c.status = 'active'
        WHERE b.branch_id = ? AND b.company_id = ? AND b.status = 'active'
        LIMIT 1`,
      [branchId, companyId]
    );

    if (!branchRows.length) {
      return res.status(400).json({
        success: false,
        message: "This company or branch is inactive or unavailable.",
      });
    }

    const [[accessRows], isSystemAdmin] = await Promise.all([
      db.execute(
        `SELECT access_id FROM user_company_access
         WHERE user_id = ? AND company_id = ? AND status = 'active'
           AND (branch_id = ? OR branch_id IS NULL)
           AND (effective_from IS NULL OR effective_from <= NOW())
           AND (effective_to IS NULL OR effective_to >= NOW())
         LIMIT 1`,
        [req.user.userId, companyId, branchId]
      ),
      isSystemAdministrator(db, req.user.userId),
    ]);

    // A System Administrator may operate in any valid company/branch.
    if (!accessRows.length && !isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized for this company/branch.",
      });
    }

    req.context = { companyId, branchId, userId: req.user.userId, isSystemAdmin };
    next();
  } catch (error) {
    next(error);
  }
}

export default operationalContext;
