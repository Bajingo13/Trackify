import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import { geocode, route } from "./geo.service.js";

const router = express.Router();

/* Place search — used by the trip location picker. */
router.get(
  "/search",
  requirePermission("trip.read"),
  asyncHandler(async (req, res) => {
    const results = await geocode(req.query.q);
    res.json({ success: true, data: results });
  })
);

/* Driving route between two points — used for the picker preview. */
router.post(
  "/route",
  requirePermission("trip.read"),
  asyncHandler(async (req, res) => {
    const r = await route(req.body.from, req.body.to, req.body.waypoints);
    if (!r) return res.status(422).json({ success: false, message: "Could not compute a route for those points." });
    res.json({ success: true, data: r });
  })
);

export default router;
