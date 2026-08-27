import express from "express";
import asyncHandler from "../../utils/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as controller from "../../controllers/operations/dispatch.controller.js";

const router = express.Router();

router.get(
  "/board",
  requirePermission("trip.assign"),
  asyncHandler(controller.getBoard)
);

router.post(
  "/trips/:id/assign",
  requirePermission("trip.assign"),
  asyncHandler(controller.assignTrip)
);

export default router;
