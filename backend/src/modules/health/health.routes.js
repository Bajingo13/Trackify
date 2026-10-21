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

/*
 * GET /api/health/live
 *
 * The Driver App's "is the internet really there" probe. A phone can report a
 * network and still reach nothing (captive portal, a tower with no backhaul),
 * so the app asks this before it calls itself online again. Every open driver
 * phone hits it every 30 seconds, so it touches nothing: no database, no
 * storage. The full check above is for operators, not phones.
 */
router.get("/live", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(204).end();
});

export default router;
