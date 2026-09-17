import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as reports from "./reports.controller.js";

/*
 * Reports. Mounted at /api/v1/reports by src/routes.js (with authenticate +
 * operationalContext).
 *
 * These return figures, not records. The permissions are the ones that already
 * existed in rbac.js for exactly these screens, so nothing about who may read a
 * report changes by moving the counting to the server.
 */
const router = express.Router();

router.get("/fleet", requirePermission("report.fleet"), asyncHandler(reports.fleetReport));
router.get("/operations", requirePermission("report.operations"), asyncHandler(reports.operationsReport));

export default router;
