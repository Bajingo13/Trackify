import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import customersRoutes from "./customers.routes.js";
import { suppliers, accounts, warehouses, taxCodes } from "./reference.controller.js";
import * as items from "../warehouse/warehouse.controller.js";

/*
 * Master Data module router. Mounted at /api/v1/master-data by src/routes.js
 * (with `authenticate` + `operationalContext`).
 */
const router = express.Router();

router.use("/customers", customersRoutes);

const crud = (path, perm, c) => {
  router.get(`/${path}`, requirePermission(`${perm}.read`), asyncHandler(c.list));
  router.post(`/${path}`, requirePermission(`${perm}.manage`), asyncHandler(c.create));
  router.patch(`/${path}/:id`, requirePermission(`${perm}.manage`), asyncHandler(c.update));
};

crud("suppliers", "supplier", suppliers);
crud("chart-of-accounts", "coa", accounts);
crud("warehouses", "warehousemd", warehouses);
crud("tax-codes", "taxcode", taxCodes);

/* Items master = the inventory item catalog (also used by Warehouse) */
router.get("/items", requirePermission("item.read"), asyncHandler(items.listItems));
router.post("/items", requirePermission("item.manage"), asyncHandler(items.createItem));
router.patch("/items/:id", requirePermission("item.manage"), asyncHandler(items.updateItem));

export default router;
