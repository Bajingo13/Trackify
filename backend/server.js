import "./src/config/env.js";
import app from "./src/app.js";
import { verifyConnection } from "./src/config/db.js";

const PORT =
  Number(process.env.PORT) ||
  Number(process.env.BACKEND_PORT) ||
  5000;

app.listen(PORT, async () => {
  console.log(`Trackify API running at http://localhost:${PORT}`);

  const ok = await verifyConnection();
  console.log(`Database connection: ${ok ? "OK" : "FAILED"}`);
  console.log(`Database: ${process.env.DB_NAME}`);
});
