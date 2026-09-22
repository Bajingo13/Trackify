import { Router } from "express";
import { login, register, getMe } from "./auth.controller.js";
import authenticate from "../../middleware/authenticate.js";
import loginRateLimit, { resetLoginThrottle } from "../../middleware/loginRateLimit.js";

const router = Router();

router.post("/login", loginRateLimit({ identityFrom: (req) => req.body?.email }), login);
router.post("/register", register);
router.get("/me", authenticate, getMe);


/*
 * Clears the sign-in throttle. Registered only outside production, so it does
 * not exist on a deployed server at all — there is no route to reach, with or
 * without a token.
 *
 * It exists for the end-to-end suite, which signs in with wrong credentials on
 * purpose and would otherwise leave that account locked out of the next run for
 * fifteen minutes.
 */
if (process.env.NODE_ENV !== "production") {
  router.post("/throttle-reset", (req, res) => {
    res.json({ success: resetLoginThrottle() });
  });
}

export default router;
