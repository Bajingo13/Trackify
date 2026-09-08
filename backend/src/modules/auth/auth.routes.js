import { Router } from "express";
import { login, register, getMe } from "./auth.controller.js";
import authenticate from "../../middleware/authenticate.js";
import loginRateLimit from "../../middleware/loginRateLimit.js";

const router = Router();

router.post("/login", loginRateLimit({ identityFrom: (req) => req.body?.email }), login);
router.post("/register", register);
router.get("/me", authenticate, getMe);

export default router;
