import db from "../config/db.js";
import { hasPermissionInScope } from "../shared/accessCheck.js";

/**
 * Route guard. `req.context` (from operationalContext) must be set first.
 * Passes when the user holds ANY of the given permission codes — or
 * SYSTEM_ADMIN, which is always sufficient — within the current company +
 * branch scope. Deny by default: no matching grant → 403.
 */
function guard(codes) {
  return async function (req, res, next) {
    try {
      if (!req.context) {
        return res.status(500).json({
          success: false,
          message: "Operating context missing before permission check.",
        });
      }

      const ok = await hasPermissionInScope(db, req.context, codes);
      if (!ok) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to perform this action.",
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** requirePermission("trip.approve") or requirePermission("a", "b") (any-of). */
export default function requirePermission(...codes) {
  return guard(codes.flat());
}

/** Explicit any-of alias for readability at call sites. */
export function requireAnyPermission(...codes) {
  return guard(codes.flat());
}
