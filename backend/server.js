import "./src/config/env.js";
import { createServer } from "node:http";
import app from "./src/app.js";
import { verifyConnection } from "./src/config/db.js";
import { attachRealtime } from "./src/realtime/hub.js";
import {
  STORAGE_IS_PERSISTENT,
  UPLOAD_ROOT,
  verifyUploadStorage,
} from "./src/modules/finance/receipts.storage.js";
import { enforceDemoCredentialPolicy } from "./src/shared/demoCredentials.js";

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

  const storage = await verifyUploadStorage();
  console.log(
    `Evidence storage: ${storage.ok ? "OK" : "FAILED"} (${storage.mode}) at ${UPLOAD_ROOT}`
  );
  if (process.env.RAILWAY_ENVIRONMENT && !STORAGE_IS_PERSISTENT) {
    console.error(
      "[storage] No Railway volume is attached. Receipt and POD uploads would be lost on redeploy."
    );
  }

  /*
   * Last, and deliberately after the port is open: bcrypt is slow by design,
   * and this must not add seconds to every restart. On a development machine
   * it returns immediately — demo credentials are the point of a demo. On
   * anything that looks like production it stops the process rather than let
   * real trips sit behind a password published in the repository.
   */
  await enforceDemoCredentialPolicy();
});
