import express from "express";
import db from "../../config/db.js";

const router = express.Router();

/* GET /api/health */
router.get("/", async (req, res) => {
  let database = "connected";

  try {
    await db.execute("SELECT 1");
  } catch {
    database = "disconnected";
  }

  res.status(database === "connected" ? 200 : 503).json({
    status: database === "connected" ? "ok" : "degraded",
    service: "trackify-api",
    database,
  });
});

export default router;
