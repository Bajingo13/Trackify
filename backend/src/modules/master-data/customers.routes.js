import express from "express";
import asyncHandler from "../../shared/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as controller from "./customers.controller.js";

const router = express.Router();

router.get("/", requirePermission("customer.read"), asyncHandler(controller.listCustomers));
router.get("/:id", requirePermission("customer.read"), asyncHandler(controller.getCustomer));
router.post("/", requirePermission("customer.manage"), asyncHandler(controller.createCustomer));
router.patch("/:id", requirePermission("customer.manage"), asyncHandler(controller.updateCustomer));

export default router;
