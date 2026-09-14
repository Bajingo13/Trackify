import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import { authenticateDriver } from "./driver.middleware.js";
import * as c from "./driver.controller.js";
import * as ex from "./driverExpenses.controller.js";
import * as profile from "./driverProfile.controller.js";
import { receiptUpload, podUpload, avatarUpload } from "../finance/receipts.storage.js";
import loginRateLimit from "../../middleware/loginRateLimit.js";

/*
 * Driver App. Mounted at /api/v1/driver by src/routes.js — NOT behind the
 * staff `authenticate` + `operationalContext` chain. Drivers sign in with an
 * employee number + PIN and get their own scoped token.
 */
const router = express.Router();

router.post(
  "/auth/login",
  loginRateLimit({ identityFrom: (req) => req.body?.employeeNo, maxPerIdentity: 5, maxPerIp: 15 }),
  asyncHandler(c.login)
);

router.use(authenticateDriver);

/* The driver's own account. Nothing here takes an id — every handler is
 * scoped to the signed-in driver, which is what stops one driver reading
 * another's licence or photograph. */
router.get("/me", asyncHandler(profile.me));
router.patch("/me", asyncHandler(profile.updateMe));
router.get("/me/photo", asyncHandler(profile.photo));
router.post("/me/photo", avatarUpload.single("photo"), asyncHandler(profile.uploadPhoto));
router.delete("/me/photo", asyncHandler(profile.removePhoto));

/* Runs already finished, and claims already filed. Both answer questions a
 * driver has when no trip is open, which is why neither hangs off /trips. */
router.get("/history", asyncHandler(profile.history));
router.get("/expenses", asyncHandler(profile.allExpenses));
router.get("/trips", asyncHandler(c.myTrips));
router.get("/trips/:id", asyncHandler(c.getTrip));
router.post("/trips/:id/ping", asyncHandler(c.ping));
router.post("/trips/:id/start", asyncHandler(c.startTrip));
// the delivery photo is optional; the receiver name is not
router.post("/trips/:id/deliver", podUpload.single("photo"), asyncHandler(c.deliverTrip));
router.get("/trips/:id/pod-photo", asyncHandler(c.myPodPhoto));

/* Expenses logged from the road. The photo is optional; the claim is not
 * posted to the books until finance approves it. */
router.get("/trips/:id/expenses", asyncHandler(ex.listMyExpenses));
router.post("/trips/:id/expenses", receiptUpload.single("receipt"), asyncHandler(ex.submitExpense));
router.get("/receipts/:attachmentId", asyncHandler(ex.myReceipt));

/* Reaching a waypoint — stamped server-side with the position the driver
 * was actually at, so a disputed drop has a record behind it. */
router.post("/trips/:id/stops/:stopId/arrive", asyncHandler(c.arriveAtStop));

export default router;
