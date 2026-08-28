import express from "express";
import tripsRoutes from "./trips.routes.js";
import dispatchRoutes from "./dispatch.routes.js";
import trackingRoutes from "./tracking.routes.js";
import exceptionsRoutes from "./exceptions.routes.js";

/*
 * Operations module router. Mounted at /api/v1/operations by src/routes.js,
 * which also applies `authenticate` + `operationalContext`.
 */
const router = express.Router();

router.use("/trips", tripsRoutes);
router.use("/dispatch", dispatchRoutes);
router.use("/tracking", trackingRoutes);
router.use("/exceptions", exceptionsRoutes);

export default router;
