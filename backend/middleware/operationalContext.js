import db from "../config/db.js";

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
      `SELECT branch_id FROM branches WHERE branch_id = ? AND company_id = ? AND status = 'active' LIMIT 1`,
      [branchId, companyId]
    );

    if (!branchRows.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid company/branch combination.",
      });
    }

    const [accessRows] = await db.execute(
      `SELECT access_id FROM user_company_access
       WHERE user_id = ? AND company_id = ? AND status = 'active'
         AND (branch_id = ? OR branch_id IS NULL)
         AND (effective_from IS NULL OR effective_from <= NOW())
         AND (effective_to IS NULL OR effective_to >= NOW())
       LIMIT 1`,
      [req.user.userId, companyId, branchId]
    );

    if (!accessRows.length) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized for this company/branch.",
      });
    }

    req.context = { companyId, branchId, userId: req.user.userId };
    next();
  } catch (error) {
    next(error);
  }
}

export default operationalContext;
