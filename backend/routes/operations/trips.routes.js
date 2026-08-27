import express from "express";
import asyncHandler from "../../utils/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as controller from "../../controllers/operations/trips.controller.js";

const router = express.Router();

router.get(
  "/",
  requirePermission("trip.read"),
  asyncHandler(controller.listTrips)
);

router.post(
  "/",
  requirePermission("trip.create"),
  asyncHandler(controller.createTrip)
);

router.get(
  "/:id",
  requirePermission("trip.read"),
  asyncHandler(controller.getTrip)
);

router.patch(
  "/:id",
  requirePermission("trip.create"),
  asyncHandler(controller.updateTrip)
);

router.post(
  "/:id/submit",
  requirePermission("trip.submit"),
  asyncHandler(controller.submitTrip)
);

router.post(
  "/:id/validate",
  requirePermission("trip.validate"),
  asyncHandler(controller.validateTrip)
);

router.post(
  "/:id/approve",
  requirePermission("trip.approve"),
  asyncHandler(controller.approveTrip)
);

router.post(
  "/:id/reject",
  requirePermission("trip.approve"),
  asyncHandler(controller.rejectTrip)
);

export default router;
