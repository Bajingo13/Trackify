import jwt from "jsonwebtoken";
import db from "../../config/db.js";
import { checkCompanyLicense, licenseRefusal } from "../../shared/license.js";
import { deviceKeyHash, isDeviceKey } from "./devices.service.js";

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
    /*
     * The token is only half of it: it must come from the phone it was issued
     * to (the X-Driver-Device key), and that phone must still be the driver's
     * trusted one. A token copied off a phone, or kept by a phone that has
     * since been replaced or revoked, stops here. See devices.service.js.
     */
    const deviceKey = req.headers["x-driver-device"];
    if (!payload.deviceId || !isDeviceKey(deviceKey)) {
      return res.status(401).json({ success: false, message: "Sign in again on this phone." });
    }
    const [[drv]] = await db.execute(
      `SELECT d.driver_id, d.company_id, d.home_branch_id, d.first_name, d.last_name, d.employee_no,
              dd.last_seen_at
         FROM drivers d
         JOIN driver_devices dd
           ON dd.driver_id = d.driver_id AND dd.device_id = ? AND dd.key_hash = ? AND dd.status = 'active'
        WHERE d.driver_id = ? AND d.status = 'active' AND d.app_enabled = 1 LIMIT 1`,
      [payload.deviceId, deviceKeyHash(deviceKey), payload.driverId]
    );
    if (!drv) {
      return res.status(401).json({
        success: false,
        message: "You've been signed out on this phone. Sign in again.",
      });
    }
    // When the office looks at the driver's phones, "last seen" is about right — written at most once a minute.
    if (!drv.last_seen_at || Date.now() - new Date(drv.last_seen_at).getTime() > 60_000) {
      db.execute("UPDATE driver_devices SET last_seen_at = NOW(3) WHERE device_id = ?", [payload.deviceId])
        .catch(() => { /* best effort */ });
    }
    // A client whose license has lapsed is locked out of the Driver App too,
    // not only the staff console — otherwise its trucks keep reporting in.
    const license = await checkCompanyLicense(db, drv.company_id);
    if (!license.valid) return res.status(403).json(licenseRefusal(license));

    req.driver = {
      driverId: drv.driver_id,
      companyId: drv.company_id,
      branchId: drv.home_branch_id,
      name: `${drv.first_name} ${drv.last_name}`.trim(),
      employeeNo: drv.employee_no,
      deviceId: payload.deviceId,
    };
    // let recordAudit() attribute driver-app actions
    req.context = { companyId: drv.company_id, branchId: drv.home_branch_id };
    req.user = { userId: null, email: `driver:${drv.employee_no}` };
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Your driver session has expired. Sign in again." });
  }
}
