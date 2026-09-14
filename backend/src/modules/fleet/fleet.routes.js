import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as typePhotos from "./vehicleTypePhotos.controller.js";
import { vehicleTypeUpload } from "../finance/receipts.storage.js";
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

/* Maintenance */
router.get("/maintenance", requirePermission("maintenance.read"), asyncHandler(maintenance.listMaintenance));
router.get("/maintenance/stats", requirePermission("maintenance.read"), asyncHandler(maintenance.maintenanceStats));
router.get("/maintenance/:id", requirePermission("maintenance.read"), asyncHandler(maintenance.getMaintenance));
router.post("/maintenance", requirePermission("maintenance.manage"), asyncHandler(maintenance.createMaintenance));
router.patch("/maintenance/:id", requirePermission("maintenance.manage"), asyncHandler(maintenance.updateMaintenance));

/* Compliance */
router.get("/compliance", requirePermission("compliance.read"), asyncHandler(compliance.listCompliance));
router.post("/compliance/documents", requirePermission("compliance.manage"), asyncHandler(compliance.createComplianceDocument));

/* Availability */
router.get("/availability", requirePermission("fleet.availability.read", "trip.assign"), asyncHandler(availability.fleetAvailability));

export default router;
