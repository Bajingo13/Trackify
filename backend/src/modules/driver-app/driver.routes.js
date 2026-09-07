import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import { authenticateDriver } from "./driver.middleware.js";
import * as c from "./driver.controller.js";
import * as ex from "./driverExpenses.controller.js";
import { receiptUpload, podUpload } from "../finance/receipts.storage.js";

/*
 * Driver App. Mounted at /api/v1/driver by src/routes.js — NOT behind the
 * staff `authenticate` + `operationalContext` chain. Drivers sign in with an
 * employee number + PIN and get their own scoped token.
 */
const router = express.Router();

router.post("/auth/login", asyncHandler(c.login));

router.use(authenticateDriver);

router.get("/me", asyncHandler(c.me));
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
