import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import routes from "./routes.js";
import corsOptions from "./config/cors.js";
import errorHandler from "./middleware/errorHandler.js";

const app = express();

app.use(helmet());

// `cors()` as global middleware also short-circuits every OPTIONS preflight.
app.use(cors(corsOptions));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

app.use(routes);

/* 404 */
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found." });
});

app.use(errorHandler);

export default app;
