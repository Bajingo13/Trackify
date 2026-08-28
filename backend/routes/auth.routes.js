import { Router } from "express";
import { login, register, getMe } from "../controllers/auth.controller.js";
import authenticate from "../middleware/authenticate.js";

const router = Router();

router.post("/login", login);
router.post("/register", register);
router.get("/me", authenticate, getMe);

export default router;
