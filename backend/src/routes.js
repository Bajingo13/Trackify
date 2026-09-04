import express from "express";

import authenticate from "./middleware/authenticate.js";
import operationalContext from "./middleware/operationalContext.js";

import healthRoutes from "./modules/health/health.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import operationsRoutes from "./modules/operations/operations.routes.js";
import fleetRoutes from "./modules/fleet/fleet.routes.js";
import warehouseRoutes from "./modules/warehouse/warehouse.routes.js";
import masterDataRoutes from "./modules/master-data/master-data.routes.js";
import financeRoutes from "./modules/finance/finance.routes.js";
import driverRoutes from "./modules/driver-app/driver.routes.js";
import customersRoutes from "./modules/master-data/customers.routes.js";

const router = express.Router();

/* Public */
router.use("/api/health", healthRoutes);
router.use("/api/auth", authRoutes);

/* Authenticated + operating-context (company/branch) scoped */
const secured = [authenticate, operationalContext];

router.use("/api/v1/admin", secured, adminRoutes);
router.use("/api/v1/operations", secured, operationsRoutes);
router.use("/api/v1/fleet", secured, fleetRoutes);
router.use("/api/v1/warehouse", secured, warehouseRoutes);
router.use("/api/v1/master-data", secured, masterDataRoutes);
router.use("/api/v1/finance", secured, financeRoutes);

/* Legacy alias — the frontend apiClient still calls /api/v1/customers */
router.use("/api/v1/customers", secured, customersRoutes);

/* Driver App — its own PIN-based auth, not the staff chain */
router.use("/api/v1/driver", driverRoutes);

export default router;
