import express from "express";
import customersRoutes from "./customers.routes.js";

/*
 * Master Data module router. Mounted at /api/v1/master-data by src/routes.js
 * (with `authenticate` + `operationalContext`). Future: items, warehouses,
 * chart-of-accounts, tax-codes.
 */
const router = express.Router();

router.use("/customers", customersRoutes);

export default router;
