import { Router } from "express";
import { activateAccount, login, getMe } from "./auth.controller.js";
import * as reset from "./passwordReset.controller.js";
import asyncHandler from "../../shared/asyncHandler.js";
import authenticate from "../../middleware/authenticate.js";
import loginRateLimit, { resetLoginThrottle } from "../../middleware/loginRateLimit.js";
import { isProduction } from "../../shared/environment.js";

const router = Router();

router.post("/login", loginRateLimit({ identityFrom: (req) => req.body?.email }), login);
router.get("/me", authenticate, getMe);
router.post("/activate", authenticate, asyncHandler(activateAccount));

/*
 * Password reset. The only part of the system a stranger can reach.
 *
 * Throttled by counting every request rather than only the failures, because
 * this endpoint answers the same way to every address on purpose — an
 * unthrottled "email me a link" button is a way to bury somebody's inbox
 * using this server's name. Three per address and ten per network address in
 * a quarter of an hour is far above honest use.
 */
router.post(
  "/forgot-password",
  loginRateLimit({
    identityFrom: (req) => req.body?.email,
    maxPerIdentity: 3,
    maxPerIp: 10,
    countAll: true,
    message: "Too many reset requests.",
  }),
  asyncHandler(reset.requestPasswordReset)
);

/* Checked before the new password is typed, so an expired link says so up
 * front rather than after somebody has carefully typed one twice. */
router.get("/reset-password", asyncHandler(reset.checkResetToken));

router.post(
  "/reset-password",
  loginRateLimit({
    identityFrom: (req) => req.body?.token,
    maxPerIdentity: 10,
    maxPerIp: 30,
    countAll: true,
    message: "Too many attempts.",
  }),
  asyncHandler(reset.completePasswordReset)
);


/*
 * Clears the sign-in throttle. Registered only outside production, so it does
 * not exist on a deployed server at all — there is no route to reach, with or
 * without a token.
 *
 * It exists for the end-to-end suite, which signs in with wrong credentials on
 * purpose and would otherwise leave that account locked out of the next run for
 * fifteen minutes.
 */
if (!isProduction()) {
  router.post("/throttle-reset", (req, res) => {
    res.json({ success: resetLoginThrottle() });
  });
}

export default router;
