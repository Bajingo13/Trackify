import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import { authenticateDriver } from "./driver.middleware.js";
import * as c from "./driver.controller.js";

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
router.post("/trips/:id/deliver", asyncHandler(c.deliverTrip));

export default router;
