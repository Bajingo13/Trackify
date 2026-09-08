import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";

import routes from "./routes.js";
import corsOptions from "./config/cors.js";
import errorHandler from "./middleware/errorHandler.js";

/* Hosts allowed to serve map tiles. Defaults to OpenStreetMap's public server,
 * which is what the frontend uses unless VITE_MAP_TILE_URL says otherwise.
 * Set MAP_TILE_HOSTS to a comma-separated list when you move to your own
 * provider. */
const MAP_TILE_HOSTS = (process.env.MAP_TILE_HOSTS || "https://tile.openstreetmap.org")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const app = express();

/* Behind Railway's proxy the socket address is the proxy's, so every visitor
 * would share one address and the login throttle would punish them as a group.
 * One hop is what Railway puts in front of us. */
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..", "dist");

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Map tiles are fetched as images. Change VITE_MAP_TILE_URL without
      // adding its host here and every tile is blocked with no visible error,
      // leaving a working map with a blank background.
      imgSrc: ["'self'", "data:", "blob:", ...MAP_TILE_HOSTS],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      workerSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
}));

// `cors()` as global middleware also short-circuits every OPTIONS preflight.
app.use(cors(corsOptions));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

app.use(routes);

/* Optional single-service mode for local/legacy deployments. Split production
 * deployments leave this disabled so this service is unambiguously API-only. */
if (process.env.SERVE_FRONTEND === "true") {
  app.use(express.static(webRoot));
  app.use((req, res, next) => {
    if (req.method === "GET" && req.accepts("html")) {
      return res.sendFile(path.join(webRoot, "index.html"));
    }
    next();
  });
}

/* 404 */
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found." });
});

app.use(errorHandler);

export default app;
