import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as controller from "./trips.controller.js";

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

router.get(
  "/:id/route",
  requirePermission("trip.read", "tracking.read"),
  asyncHandler(controller.getTripRoute)
);

router.patch(
  "/:id",
  requirePermission("trip.update", "trip.create"),
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
  requirePermission("trip.reject", "trip.approve"),
  asyncHandler(controller.rejectTrip)
);

/* post-approval lifecycle */
router.post("/:id/release", requirePermission("trip.release"), asyncHandler(controller.releaseTrip));
router.post("/:id/start", requirePermission("trip.release", "tracking.update"), asyncHandler(controller.startTrip));
router.post("/:id/deliver", requirePermission("trip.close", "tracking.update"), asyncHandler(controller.deliverTrip));
router.post("/:id/close", requirePermission("trip.close"), asyncHandler(controller.closeTrip));
router.post("/:id/cancel", requirePermission("trip.cancel"), asyncHandler(controller.cancelTrip));

/* The delivery photo. Streamed through an authenticated, company-scoped route
 * like every other captured file — never served as a static directory. */
router.get("/:id/pod-photo", requirePermission("trip.read"), asyncHandler(controller.getPodPhoto));

export default router;
