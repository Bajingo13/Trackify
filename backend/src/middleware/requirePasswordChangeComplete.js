import db from "../config/db.js";

/** Keep temporary credentials out of every business endpoint. */
export function passwordChangeGuard(runner = db) {
  return async function requirePasswordChangeComplete(req, res, next) {
    try {
      // Read the live value as well as the claim. If an administrator resets an
      // account, tokens issued before that reset must not keep working.
      const [rows] = await runner.execute(
        "SELECT must_change_password FROM users WHERE user_id = ? AND status = 'active' LIMIT 1",
        [req.user?.userId]
      );
      if (!rows.length) {
        return res.status(401).json({ success: false, message: "Account is not active." });
      }
      if (req.user?.mustChangePassword || rows[0].must_change_password) {
        return res.status(403).json({
          success: false,
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "Change your temporary password before using Trackify.",
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export default passwordChangeGuard();
