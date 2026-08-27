import express from "express";
import asyncHandler from "../../utils/asyncHandler.js";
import requirePermission from "../../middleware/requirePermission.js";
import * as controller from "../../controllers/operations/customers.controller.js";

const router = express.Router();

router.get(
  "/",
  requirePermission("customer.read"),
  asyncHandler(controller.searchCustomers)
);

router.get(
  "/:id",
  requirePermission("customer.read"),
  asyncHandler(controller.getCustomer)
);

export default router;
