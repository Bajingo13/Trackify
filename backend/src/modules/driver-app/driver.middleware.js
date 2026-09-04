import jwt from "jsonwebtoken";
import db from "../../config/db.js";

/**
 * Driver App auth. Tokens are minted by POST /driver/auth/login and carry
 * `kind: "driver"` so they can't be confused with staff tokens.
 */
export async function authenticateDriver(req, res, next) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Driver sign-in required." });
  }
  try {
    const payload = jwt.verify(authorization.substring(7), process.env.JWT_SECRET);
    if (payload.kind !== "driver" || !payload.driverId) {
      return res.status(401).json({ success: false, message: "Not a driver session." });
    }
    const [[drv]] = await db.execute(
      `SELECT driver_id, company_id, home_branch_id, first_name, last_name, employee_no
         FROM drivers
        WHERE driver_id = ? AND status = 'active' AND app_enabled = 1 LIMIT 1`,
      [payload.driverId]
    );
    if (!drv) {
      return res.status(401).json({ success: false, message: "Driver account is disabled." });
    }
    req.driver = {
      driverId: drv.driver_id,
      companyId: drv.company_id,
      branchId: drv.home_branch_id,
      name: `${drv.first_name} ${drv.last_name}`.trim(),
      employeeNo: drv.employee_no,
    };
    // let recordAudit() attribute driver-app actions
    req.context = { companyId: drv.company_id, branchId: drv.home_branch_id };
    req.user = { userId: null, email: `driver:${drv.employee_no}` };
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Your driver session has expired. Sign in again." });
  }
}
