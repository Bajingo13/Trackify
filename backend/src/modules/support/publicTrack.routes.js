import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import publicRateLimit from "../../middleware/publicRateLimit.js";
import * as pause from "./pause.controller.js";

/*
 * What a customer may see of their delivery. Mounted at /api/public — NOT behind
 * the staff chain: there is no customer sign-in in this system, so the link they
 * were given is the credential. Read-only, one delivery per link, throttled per
 * address so a run at guessing tokens is stopped long before it could succeed.
 */
const router = express.Router();

router.get("/track/:token", publicRateLimit({ max: 60 }), asyncHandler(pause.publicTrack));

export default router;
