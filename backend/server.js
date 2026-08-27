import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import db from "./config/db.js";
import authenticate from "./middleware/authenticate.js";
import operationalContext from "./middleware/operationalContext.js";
import errorHandler from "./middleware/errorHandler.js";
import tripsRoutes from "./routes/operations/trips.routes.js";
import dispatchRoutes from "./routes/operations/dispatch.routes.js";
import trackingRoutes from "./routes/operations/tracking.routes.js";
import exceptionsRoutes from "./routes/operations/exceptions.routes.js";
import customersRoutes from "./routes/operations/customers.routes.js";

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
  })
);

app.use(
  express.json({
    limit: "2mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(morgan("dev"));

/* Health */

app.get(
  "/api/health",

  async (req, res, next) => {
    try {
      await db.execute(
        "SELECT 1"
      );

      res.json({
        success: true,
        database: "connected",
        service:
          "AstreaBlue Trackify API"
      });
    } catch (error) {
      next(error);
    }
  }
);

/* Authentication required below */

app.use(
  "/api/v1/operations",
  authenticate,
  operationalContext
);

/* Operations only */

app.use(
  "/api/v1/operations/trips",
  tripsRoutes
);

app.use(
  "/api/v1/operations/dispatch",
  dispatchRoutes
);

app.use(
  "/api/v1/operations/tracking",
  trackingRoutes
);

app.use(
  "/api/v1/operations/exceptions",
  exceptionsRoutes
);

app.use(
  "/api/v1/customers",
  authenticate,
  operationalContext,
  customersRoutes
);

/* 404 */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message:
      "Route not found."
  });
});

app.use(errorHandler);

const PORT =
  Number(process.env.PORT) ||
  5000;

app.listen(PORT, () => {
  console.log(
    `Trackify API running at http://localhost:${PORT}`
  );
});
