import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import { authenticateDriver } from "./driver.middleware.js";
import * as c from "./driver.controller.js";
import * as ex from "./driverExpenses.controller.js";
import * as profile from "./driverProfile.controller.js";
import * as agreement from "./driverAgreement.controller.js";
import * as chat from "../chat/tripChat.controller.js";
import * as support from "../support/support.controller.js";
import * as pause from "../support/pause.controller.js";
import * as push from "../support/push.controller.js";
import { receiptUpload, podUpload, avatarUpload, chatPhotoUpload, pausePhotoUpload } from "../finance/receipts.storage.js";
import loginRateLimit from "../../middleware/loginRateLimit.js";
import { readPendingToken } from "./devices.service.js";

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

/* A phone that signed in with the right PIN but is not the driver's trusted
 * phone. These take the short pending token, not a driver session, and open
 * nothing else. See devices.service.js. */
const pendingDriverId = (req) => {
  const p = readPendingToken(req.body?.pendingToken);
  return p ? `driver-${p.driverId}` : "";
};
router.post(
  "/auth/device/verify",
  loginRateLimit({ identityFrom: pendingDriverId, maxPerIdentity: 5, maxPerIp: 15, message: "Too many wrong codes." }),
  asyncHandler(c.verifyDevice)
);
// Polled every 5 seconds while a phone waits; generous, but not unlimited.
router.post(
  "/auth/device/status",
  loginRateLimit({ identityFrom: pendingDriverId, maxPerIdentity: 400, maxPerIp: 600, countAll: true, message: "Too many checks." }),
  asyncHandler(c.deviceStatus)
);
// Each one sends an email; the service also holds a minute between sends and five an hour.
router.post(
  "/auth/device/resend",
  loginRateLimit({ identityFrom: pendingDriverId, maxPerIdentity: 6, maxPerIp: 20, countAll: true, message: "Too many codes asked for." }),
  asyncHandler(c.resendDeviceEmail)
);
router.post(
  "/auth/device/ask-office",
  loginRateLimit({ identityFrom: pendingDriverId, maxPerIdentity: 10, maxPerIp: 30, countAll: true, message: "Too many requests." }),
  asyncHandler(c.askOfficeForDevice)
);

router.use(authenticateDriver);

/* The Terms of Service and Data Privacy Policy. First thing after sign-in: the
 * app does not open until this is accepted, because section 4.3 offers consent
 * as the legal basis for the location collection in 4.1.1 and a driver is the
 * person that collection is about. Same document as the staff routes serve. */
router.get("/agreement", asyncHandler(agreement.current));
router.post("/agreement/accept", asyncHandler(agreement.accept));

/* The driver's own account. Nothing here takes an id — every handler is
 * scoped to the signed-in driver, which is what stops one driver reading
 * another's licence or photograph. */
router.get("/me", asyncHandler(profile.me));
// Every try counts: a wrong current PIN answers 403, which the limiter would not see as a failure.
router.post(
  "/pin",
  loginRateLimit({ identityFrom: (req) => `pin-${req.driver?.driverId}`, maxPerIdentity: 5, maxPerIp: 15, countAll: true, message: "Too many tries. Wait a while before trying again." }),
  asyncHandler(profile.changePin)
);

/* The live socket: a short ticket for /ws, so a message from dispatch reaches
 * the bell as it is sent rather than at the next poll. */
router.get("/realtime-ticket", c.realtimeTicket);
router.patch("/me", asyncHandler(profile.updateMe));
router.get("/me/photo", asyncHandler(profile.photo));
router.post("/me/photo", avatarUpload.single("photo"), asyncHandler(profile.uploadPhoto));
router.delete("/me/photo", asyncHandler(profile.removePhoto));

/* The driver's licence photo, VIEW ONLY. The licence — number, type, expiry and
 * the photo — is a compliance record the office owns: it is added and changed in
 * the back office (/fleet/drivers/:id/license-photo and PATCH /fleet/drivers/:id)
 * and this reads what is there, so the app can never disagree with the office.
 * There is deliberately no write route for it here. */
router.get("/me/license-photo", asyncHandler(profile.licensePhoto));


/* Runs already finished, and claims already filed. Both answer questions a
 * driver has when no trip is open, which is why neither hangs off /trips. */
router.get("/history", asyncHandler(profile.history));
router.get("/expenses", asyncHandler(profile.allExpenses));
/* The company's own photo for a kind of vehicle, so the phone and the web
 * system show the same truck. */
router.get("/vehicle-types/:type/photo", asyncHandler(c.vehicleTypePhoto));

/* Help & Support: concerns, problems and requests for the office. Every
 * handler is the signed-in driver's own; none takes a driver id. */
router.get("/support/unread", asyncHandler(support.driverUnread));
router.get("/support", asyncHandler(support.driverList));
router.post("/support", asyncHandler(support.driverCreate));
router.get("/support/:id", asyncHandler(support.driverGet));
router.post("/support/:id/messages", asyncHandler(support.driverReply));
router.post("/support/:id/reopen", asyncHandler(support.driverReopen));

/* Notifications to this driver's phone */
router.get("/push/key", asyncHandler(push.key));
router.post("/push/subscribe", asyncHandler(push.subscribe));
router.post("/push/unsubscribe", asyncHandler(push.unsubscribe));

/* Pause requests: ask the office to hold a delivery for a real interruption, with
 * a reason, a description and photographs. Only a trip assigned to this driver. */
router.post("/trips/:id/pause", pausePhotoUpload.array("photos"), asyncHandler(pause.driverCreate));
router.get("/trips/:id/pause", asyncHandler(pause.driverActive));
router.post("/trips/:id/pause/withdraw", asyncHandler(pause.driverWithdraw));
router.post("/trips/:id/pause/resume", asyncHandler(pause.driverResume));
router.get("/pauses", asyncHandler(pause.driverHistory));
router.get("/pauses/:id/photos/:photoId", asyncHandler(pause.driverPhoto));

/* Chat with dispatch about one trip. Only a trip assigned to this driver. */
router.get("/messages/unread", asyncHandler(chat.driverUnreadSummary));
router.get("/trips/:id/messages", asyncHandler(chat.driverList));
router.post("/trips/:id/messages", asyncHandler(chat.driverSend));
router.post("/trips/:id/messages/read", asyncHandler(chat.driverRead));
router.delete("/trips/:id/messages", asyncHandler(chat.driverDelete));
router.post("/trips/:id/messages/photo", chatPhotoUpload.single("photo"), asyncHandler(chat.driverSendPhoto));
router.get("/trips/:id/messages/:messageId/photo", asyncHandler(chat.driverPhoto));

router.get("/trips", asyncHandler(c.myTrips));
router.get("/trips/:id", asyncHandler(c.getTrip));
router.get("/trips/:id/trail", asyncHandler(c.myTrail));
router.post("/trips/:id/ping", asyncHandler(c.ping));
// GPS points kept on the phone through a dead zone, sent in batches once back in coverage
router.post("/trips/:id/trail", asyncHandler(c.trail));
router.post("/trips/:id/start", asyncHandler(c.startTrip));
// the delivery photo is optional; the receiver name is not
router.post("/trips/:id/deliver", podUpload.single("photo"), asyncHandler(c.deliverTrip));
router.get("/trips/:id/pod-photo", asyncHandler(c.myPodPhoto));

/* Expenses logged from the road. The photo is optional; the claim is not
 * posted to the books until finance approves it. */
router.get("/trips/:id/expenses", asyncHandler(ex.listMyExpenses));
router.post("/trips/:id/expenses", receiptUpload.single("receipt"), asyncHandler(ex.submitExpense));
router.get("/receipts/:attachmentId", asyncHandler(ex.myReceipt));
/* Read a receipt photo to fill in the claim form. Stateless: nothing is filed
 * or kept, and the driver can always type the claim in instead. */
router.post("/receipts/scan", receiptUpload.single("receipt"), asyncHandler(ex.scanReceiptPhoto));

/* Reaching a waypoint — stamped server-side with the position the driver
 * was actually at, so a disputed drop has a record behind it. */
router.post("/trips/:id/stops/:stopId/arrive", asyncHandler(c.arriveAtStop));

export default router;
