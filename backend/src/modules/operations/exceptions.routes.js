import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as controller from "./exceptions.controller.js";
import * as driver from "../support/exceptionBridge.controller.js";

const router = express.Router();

router.get(
  "/",
  requirePermission("exception.read"),
  asyncHandler(controller.listExceptions)
);

/* Drivers' Help & Support messages nobody in the office has read yet, for the
 * notification bell. Read with the right to read those requests. */
router.get("/driver-messages", requirePermission("support.read"), asyncHandler(driver.unreadDriverMessages));

router.post(
  "/",
  requirePermission("exception.create"),
  asyncHandler(controller.createException)
);

router.post(
  "/:id/acknowledge",
  requirePermission("exception.resolve"),
  asyncHandler(controller.acknowledgeException)
);

router.post(
  "/:id/resolve",
  requirePermission("exception.resolve"),
  asyncHandler(controller.resolveException)
);

/* What a driver reported behind an exception — the pause, its photographs — and the
 * office's answer to it. Reading follows the board; answering follows resolving. */
router.get("/:id/driver-report", requirePermission("exception.read"), asyncHandler(driver.report));
router.get("/:id/driver-report/photos/:photoId", requirePermission("exception.read"), asyncHandler(driver.photo));
/* The conversation with the driver behind it. What a driver confides to the office
 * is not for every role that can read the board: reading it needs support.read and
 * writing back needs support.manage, and the read-only Auditor role has neither. */
router.get("/:id/driver-report/thread", requirePermission("support.read"), asyncHandler(driver.thread));
router.post("/:id/driver-report/reply", requirePermission("support.manage"), asyncHandler(driver.reply));
router.post("/:id/pause/approve", requirePermission("exception.resolve"), asyncHandler(driver.approve));
router.post("/:id/pause/decline", requirePermission("exception.resolve"), asyncHandler(driver.decline));
router.post("/:id/pause/resume", requirePermission("exception.resolve"), asyncHandler(driver.resume));

export default router;
