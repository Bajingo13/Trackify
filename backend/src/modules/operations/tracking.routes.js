import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as controller from "./tracking.controller.js";

const router = express.Router();

router.post(
  "/realtime-ticket",
  requirePermission("trip.read", "tracking.read"),
  asyncHandler(controller.realtimeTicket)
);

router.get(
  "/active-trips",
  requirePermission("tracking.read"),
  asyncHandler(controller.activeTrips)
);

router.get(
  "/trips/:id/history",
  requirePermission("tracking.read"),
  asyncHandler(controller.trackingHistory)
);

router.post(
  "/trips/:id/points",
  requirePermission("tracking.update"),
  asyncHandler(controller.addTrackingPoint)
);

export default router;
