import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as typePhotos from "./vehicleTypePhotos.controller.js";
import { vehicleTypeUpload, licenseUpload, documentUpload, receiptUpload } from "../finance/receipts.storage.js";
import * as documents from "./fleetDocuments.controller.js";
import * as vehicles from "./vehicles.controller.js";
import * as drivers from "./drivers.controller.js";
import * as maintenance from "./maintenance.controller.js";
import * as compliance from "./compliance.controller.js";
import * as availability from "./availability.controller.js";

/*
 * Fleet module. Mounted at /api/v1/fleet by src/routes.js
 * (with authenticate + operationalContext).
 */
const router = express.Router();

/* Vehicles */
/* A company's own photograph for a kind of vehicle. Reading one is part of
 * reading the fleet — dispatch and tracking draw these too — so it sits behind
 * vehicle.read, while changing what a whole fleet looks like needs manage.
 *
 * These are declared before /vehicles/:id so "vehicle-types" is never matched
 * as a vehicle id. */
router.get("/vehicle-types/photos", requirePermission("vehicle.read"), asyncHandler(typePhotos.listTypePhotos));
router.get("/vehicle-types/:type/photo", requirePermission("vehicle.read"), asyncHandler(typePhotos.serveTypePhoto));
router.post(
  "/vehicle-types/:type/photo",
  requirePermission("vehicle.manage"),
  vehicleTypeUpload.single("photo"),
  asyncHandler(typePhotos.uploadTypePhoto)
);
router.delete("/vehicle-types/:type/photo", requirePermission("vehicle.manage"), asyncHandler(typePhotos.removeTypePhoto));

router.get("/vehicles", requirePermission("vehicle.read"), asyncHandler(vehicles.listVehicles));
router.get("/vehicles/stats", requirePermission("vehicle.read"), asyncHandler(vehicles.vehicleStats));
router.get("/vehicles/:id", requirePermission("vehicle.read"), asyncHandler(vehicles.getVehicle));
router.post("/vehicles", requirePermission("vehicle.manage"), asyncHandler(vehicles.createVehicle));
router.patch("/vehicles/:id", requirePermission("vehicle.manage"), asyncHandler(vehicles.updateVehicle));

/* Drivers */
router.get("/drivers", requirePermission("driver.read"), asyncHandler(drivers.listDrivers));
router.get("/drivers/stats", requirePermission("driver.read"), asyncHandler(drivers.driverStats));
router.get("/drivers/:id", requirePermission("driver.read"), asyncHandler(drivers.getDriver));
router.post("/drivers", requirePermission("driver.manage"), asyncHandler(drivers.createDriver));
router.patch("/drivers/:id", requirePermission("driver.manage"), asyncHandler(drivers.updateDriver));
router.patch("/drivers/:id/app-access", requirePermission("driver.manage"), asyncHandler(drivers.setDriverAppAccess));

/* The driver's licence, photographed. A driver can upload their own from the
 * app; the office uploads or replaces it here. Reading it is part of reading
 * the driver, but it is a photograph of an identity document, so it is streamed
 * through this route and never served from a directory. */
router.get("/drivers/:id/license-photo", requirePermission("driver.read"), asyncHandler(documents.driverLicensePhoto));
router.post(
  "/drivers/:id/license-photo",
  requirePermission("driver.manage"),
  licenseUpload.single("photo"),
  asyncHandler(documents.uploadDriverLicensePhoto)
);
router.delete("/drivers/:id/license-photo", requirePermission("driver.manage"), asyncHandler(documents.removeDriverLicensePhoto));

/* Maintenance */
router.get("/maintenance", requirePermission("maintenance.read"), asyncHandler(maintenance.listMaintenance));
router.get("/maintenance/stats", requirePermission("maintenance.read"), asyncHandler(maintenance.maintenanceStats));
/* Declared before /maintenance/:id so "attachments" is never read as an id. */
router.get("/maintenance/attachments/:attachmentId", requirePermission("maintenance.read"), asyncHandler(documents.serveMaintenanceAttachment));
router.delete("/maintenance/attachments/:attachmentId", requirePermission("maintenance.manage"), asyncHandler(documents.removeMaintenanceAttachment));
router.get("/maintenance/:id", requirePermission("maintenance.read"), asyncHandler(maintenance.getMaintenance));
router.post("/maintenance", requirePermission("maintenance.manage"), asyncHandler(maintenance.createMaintenance));
router.patch("/maintenance/:id", requirePermission("maintenance.manage"), asyncHandler(maintenance.updateMaintenance));

/* The paperwork behind a job: parts invoice, labour receipt, warranty slip.
 * Several per job is the normal case, which is why these are a list. */
router.get("/maintenance/:id/attachments", requirePermission("maintenance.read"), asyncHandler(documents.listMaintenanceAttachments));
router.post(
  "/maintenance/:id/attachments",
  requirePermission("maintenance.manage"),
  receiptUpload.single("file"),
  asyncHandler(documents.uploadMaintenanceAttachment)
);

/* Compliance */
router.get("/compliance", requirePermission("compliance.read"), asyncHandler(compliance.listCompliance));
router.post("/compliance/documents", requirePermission("compliance.manage"), asyncHandler(compliance.createComplianceDocument));

/* A compliance row records that a certificate exists and when it lapses. This
 * is where the certificate itself goes — one file per document, because the
 * row is the document. Uploading again is what renewing one means. */
router.get("/compliance/documents/:id/file", requirePermission("compliance.read"), asyncHandler(documents.serveComplianceFile));
router.post(
  "/compliance/documents/:id/file",
  requirePermission("compliance.manage"),
  documentUpload.single("file"),
  asyncHandler(documents.uploadComplianceFile)
);
router.delete("/compliance/documents/:id/file", requirePermission("compliance.manage"), asyncHandler(documents.removeComplianceFile));

/* Availability */
router.get("/availability", requirePermission("fleet.availability.read", "trip.assign"), asyncHandler(availability.fleetAvailability));

export default router;
