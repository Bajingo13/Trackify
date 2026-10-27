import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as controller from "./trips.controller.js";
import * as pause from "../support/pause.controller.js";

const router = express.Router();

router.get(
  "/",
  requirePermission("trip.read"),
  asyncHandler(controller.listTrips)
);

/* Declared before "/:id" so "summary" and "search" are not read as trip ids. */
router.get(
  "/summary",
  requirePermission("trip.read"),
  asyncHandler(controller.tripsSummary)
);

router.get(
  "/search",
  requirePermission("trip.read"),
  asyncHandler(controller.searchTrips)
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
router.get("/:id/pod-signature", requirePermission("trip.read"), asyncHandler(controller.getPodSignature));

/* The link a customer is given to follow their delivery. Creating it shares
 * information outside the company, so it has a permission of its own. */
router.post("/:id/tracking-link", requirePermission("tracking.share"), asyncHandler(pause.linkGet));
router.delete("/:id/tracking-link", requirePermission("tracking.share"), asyncHandler(pause.linkRevoke));

export default router;
