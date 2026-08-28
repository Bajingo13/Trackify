import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as controller from "./exceptions.controller.js";

const router = express.Router();

router.get(
  "/",
  requirePermission("exception.read"),
  asyncHandler(controller.listExceptions)
);

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

export default router;
