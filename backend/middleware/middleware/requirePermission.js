const db = require("../config/db.cjs");

function requirePermission(permissionCode) {
  return async function (req, res, next) {
    try {
      const {
        userId,
        companyId,
        branchId
      } = req.context;

      const [rows] = await db.execute(
        `
        SELECT 1
        FROM user_roles ur

        INNER JOIN role_permissions rp
          ON rp.role_id = ur.role_id

        INNER JOIN permissions p
          ON p.permission_id = rp.permission_id

        WHERE ur.user_id = ?
          AND ur.company_id = ?
          AND ur.status = 'active'
          AND (
              ur.branch_id = ?
              OR ur.branch_id IS NULL
          )
          AND p.permission_code = ?

        LIMIT 1
        `,
        [
          userId,
          companyId,
          branchId,
          permissionCode
        ]
      );

      if (!rows.length) {
        return res.status(403).json({
          success: false,
          message:
            "You do not have permission to perform this action."
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = requirePermission;