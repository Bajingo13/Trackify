import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as chat from "./tripChat.controller.js";

/*
 * Trip chat for dispatch. Mounted at /api/v1/operations/chat, behind the
 * staff authenticate + operating-context chain.
 *
 * Reading follows live tracking: whoever may watch a truck may read what its
 * driver says. Sending is for the people who run the trip — dispatchers,
 * branch managers, administrators — not for read-only roles like auditors.
 */
const READ = ["tracking.read"];
const SEND = ["tracking.update", "trip.assign", "trip.release"];

const router = express.Router();

router.get("/unread", requirePermission(...READ), asyncHandler(chat.staffUnreadSummary));
router.get("/trips/:id", requirePermission(...READ), asyncHandler(chat.staffList));
router.post("/trips/:id", requirePermission(...SEND), asyncHandler(chat.staffSend));
router.post("/trips/:id/read", requirePermission(...READ), asyncHandler(chat.staffRead));

export default router;
