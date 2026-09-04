import "./src/config/env.js";
import { createServer } from "node:http";
import app from "./src/app.js";
import { verifyConnection } from "./src/config/db.js";
import { attachRealtime } from "./src/realtime/hub.js";

const PORT =
  Number(process.env.PORT) ||
  Number(process.env.BACKEND_PORT) ||
  5000;

// Wrap the Express app in an explicit HTTP server so the WebSocket hub can
// share the same port.
const server = createServer(app);
attachRealtime(server);

server.listen(PORT, async () => {
  console.log(`Trackify API running at http://localhost:${PORT}`);

  const ok = await verifyConnection();
  console.log(`Database connection: ${ok ? "OK" : "FAILED"}`);
  console.log(`Database: ${process.env.DB_NAME}`);
});
