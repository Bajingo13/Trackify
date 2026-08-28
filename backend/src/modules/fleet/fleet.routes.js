import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
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

/* Maintenance */
router.get("/maintenance", requirePermission("maintenance.read"), asyncHandler(maintenance.listMaintenance));
router.get("/maintenance/stats", requirePermission("maintenance.read"), asyncHandler(maintenance.maintenanceStats));
router.post("/maintenance", requirePermission("maintenance.manage"), asyncHandler(maintenance.createMaintenance));
router.patch("/maintenance/:id", requirePermission("maintenance.manage"), asyncHandler(maintenance.updateMaintenance));

/* Compliance */
router.get("/compliance", requirePermission("compliance.read"), asyncHandler(compliance.listCompliance));
router.post("/compliance/documents", requirePermission("compliance.manage"), asyncHandler(compliance.createComplianceDocument));

/* Availability */
router.get("/availability", requirePermission("fleet.availability.read", "trip.assign"), asyncHandler(availability.fleetAvailability));

export default router;
