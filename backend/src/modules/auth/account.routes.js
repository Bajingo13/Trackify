import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import authenticate from "../../middleware/authenticate.js";
import { avatarUpload } from "../finance/receipts.storage.js";
import * as account from "./account.controller.js";

/**
 * Your own account: your name, your email, your password, your photograph.
 *
 * Authenticated but deliberately not company-scoped. These belong to the
 * person, not to whichever branch they happen to be working in today, and a
 * user who has not yet picked an operating context still has to be able to
 * change their own password.
 */
const router = express.Router();

router.patch("/", asyncHandler(account.updateMyProfile));
router.post("/password", asyncHandler(account.changeMyPassword));

router.get("/photo", asyncHandler(account.myPhoto));
router.post("/photo", avatarUpload.single("photo"), asyncHandler(account.uploadMyPhoto));
router.delete("/photo", asyncHandler(account.removeMyPhoto));

export default router;
