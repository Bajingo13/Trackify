import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import { geocode, geocodeBest, geocodeStructured, reverseGeocode } from "./geo.address.js";
import { route } from "./geo.service.js";

const router = express.Router();

/* Place search — used by the trip location picker.
 *
 * near.lat/near.lng bias results toward the area the dispatcher is looking at,
 * which is what stops a street name resolving to the same-named street on the
 * other side of the country. */
router.get(
  "/search",
  requirePermission("trip.read"),
  asyncHandler(async (req, res) => {
    const near = req.query.lat && req.query.lng
      ? { lat: req.query.lat, lng: req.query.lng }
      : null;
    const results = await geocode(req.query.q, { near });
    res.json({ success: true, data: results });
  })
);

/* The same search, but it gives up one component at a time rather than
 * answering a typed address with silence.
 *
 * Kept separate from /search because it returns what actually matched as well
 * as the results: a pin placed on the municipality when a house number was
 * typed has to say so, and the caller cannot tell from the results alone. */
router.get(
  "/search/best",
  requirePermission("trip.read"),
  asyncHandler(async (req, res) => {
    const near = req.query.lat && req.query.lng
      ? { lat: req.query.lat, lng: req.query.lng }
      : null;
    const { results, matchedQuery, degraded, tried } = await geocodeBest(req.query.q, { near });
    res.json({ success: true, data: results, matchedQuery, degraded, tried });
  })
);

/* Structured search — a house number, street, barangay and city in their own
 * fields, which Nominatim matches far better than the same words run together
 * into one string. */
router.get(
  "/search/address",
  requirePermission("trip.read"),
  asyncHandler(async (req, res) => {
    const { houseNumber, street, barangay, city, province, postcode, lat, lng } = req.query;
    const results = await geocodeStructured({
      houseNumber, street, barangay, city, province, postcode,
      near: lat && lng ? { lat, lng } : null,
    });
    res.json({ success: true, data: results });
  })
);

/* What is at this point — so a dropped pin records an address instead of its
 * own coordinates. Dropping a pin is the only way to place a house that is not
 * in OpenStreetMap, so it must not be the least informative option. */
router.get(
  "/reverse",
  requirePermission("trip.read"),
  asyncHandler(async (req, res) => {
    const hit = await reverseGeocode(req.query.lat, req.query.lng);
    if (!hit) return res.status(404).json({ success: false, message: "Nothing could be found at that point." });
    res.json({ success: true, data: hit });
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
