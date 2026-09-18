import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import * as agreement from "./agreement.controller.js";

/*
 * Terms of Service and Data Privacy Policy. Mounted at /api/v1/agreement by
 * src/routes.js behind `authenticate` ONLY — deliberately not the
 * authenticate + operationalContext chain every other /api/v1 route uses.
 *
 * Section 2.1 requires acceptance before an account is activated, so the one
 * thing these routes must work for is a user who has signed in and done nothing
 * else. Requiring a company and branch first would lock out exactly that user.
 *
 * No permission is required either: consent is not a privilege, and a user with
 * no permissions at all still has to be able to read what they are agreeing to.
 */
const router = express.Router();

router.get("/", asyncHandler(agreement.current));
router.post("/accept", asyncHandler(agreement.accept));
router.get("/history", asyncHandler(agreement.history));

export default router;
