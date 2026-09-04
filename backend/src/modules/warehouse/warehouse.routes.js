import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as c from "./warehouse.controller.js";
import * as t from "./transfers.controller.js";
import * as cargo from "./cargo.controller.js";

/*
 * Warehouse module. Mounted at /api/v1/warehouse by src/routes.js
 * (with authenticate + operationalContext).
 */
const router = express.Router();

router.get("/locations", requirePermission("inventory.read", "stockmovement.read"), asyncHandler(c.listLocations));

/* item catalog */
router.get("/items", requirePermission("inventory.read"), asyncHandler(c.listItems));
router.post("/items", requirePermission("inventory.manage"), asyncHandler(c.createItem));
router.patch("/items/:id", requirePermission("inventory.manage"), asyncHandler(c.updateItem));

/* stock levels */
router.get("/inventory", requirePermission("inventory.read"), asyncHandler(c.listInventory));
router.get("/inventory/stats", requirePermission("inventory.read"), asyncHandler(c.inventoryStats));
router.get("/inventory/low-stock", requirePermission("inventory.read"), asyncHandler(c.lowStock));

/* stock movements */
router.get("/movements", requirePermission("stockmovement.read"), asyncHandler(c.listMovements));
router.get("/movements/stats", requirePermission("stockmovement.read"), asyncHandler(c.movementStats));
router.post("/movements", requirePermission("stockmovement.manage"), asyncHandler(c.createMovement));
router.post("/movements/:id/receive", requirePermission("stockmovement.manage"), asyncHandler(c.receiveMovement));
router.post("/movements/:id/cancel", requirePermission("stockmovement.manage"), asyncHandler(c.cancelMovement));

/* branch transfers */
router.get("/transfers", requirePermission("transfer.read"), asyncHandler(t.listTransfers));
router.get("/transfers/stats", requirePermission("transfer.read"), asyncHandler(t.transferStats));
router.get("/transfers/:id", requirePermission("transfer.read"), asyncHandler(t.getTransfer));
router.post("/transfers", requirePermission("transfer.manage"), asyncHandler(t.createTransfer));
router.post("/transfers/:id/approve", requirePermission("transfer.manage"), asyncHandler(t.approveTransfer));
router.post("/transfers/:id/dispatch", requirePermission("transfer.manage"), asyncHandler(t.dispatchTransfer));
router.post("/transfers/:id/receive", requirePermission("transfer.manage"), asyncHandler(t.receiveTransfer));
router.post("/transfers/:id/cancel", requirePermission("transfer.manage"), asyncHandler(t.cancelTransfer));

/* cargo release / return */
router.get("/cargo/queue", requirePermission("cargo.release", "cargo.return", "warehouse.read"), asyncHandler(cargo.cargoQueue));
router.get("/cargo/events", requirePermission("cargo.release", "cargo.return", "warehouse.read"), asyncHandler(cargo.cargoEvents));
router.get("/cargo/stats", requirePermission("cargo.release", "cargo.return", "warehouse.read"), asyncHandler(cargo.cargoStats));
router.post("/cargo/release", requirePermission("cargo.release"), asyncHandler(cargo.releaseCargo));
router.post("/cargo/return", requirePermission("cargo.return"), asyncHandler(cargo.returnCargo));

export default router;
