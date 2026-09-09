import express from "express";
import db from "../../config/db.js";
import {
  STORAGE_IS_PERSISTENT,
  verifyUploadStorage,
} from "../finance/receipts.storage.js";

const router = express.Router();

/* GET /api/health */
router.get("/", async (req, res) => {
  let database = "connected";

  try {
    await db.execute("SELECT 1");
  } catch {
    database = "disconnected";
  }

  const storageCheck = await verifyUploadStorage();
  const railwayStorageMissing = Boolean(process.env.RAILWAY_ENVIRONMENT) && !STORAGE_IS_PERSISTENT;
  const healthy = database === "connected" && storageCheck.ok && !railwayStorageMissing;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    service: "trackify-api",
    database,
    storage: railwayStorageMissing ? "ephemeral" : storageCheck.mode,
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || "development",
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

export default router;
