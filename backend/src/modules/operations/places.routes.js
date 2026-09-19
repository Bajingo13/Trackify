import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as places from "./places.controller.js";

/*
 * The company's own pinned places. Mounted at /api/v1/operations/places.
 *
 * Reading them is part of reading a trip — the picker searches these before
 * the geocoder — so it sits behind trip.read. Saving one is gated on
 * trip.create rather than a permission of its own: anybody who can book a trip
 * to a place can record where that place is, and a separate code would need
 * granting to every role that already has the more powerful right.
 */
const router = express.Router();

router.get("/", requirePermission("trip.read"), asyncHandler(places.listPlaces));
router.post("/", requirePermission("trip.create"), asyncHandler(places.savePlace));
router.post("/:id/used", requirePermission("trip.read"), asyncHandler(places.markUsed));
router.delete("/:id", requirePermission("trip.create"), asyncHandler(places.deletePlace));

export default router;
