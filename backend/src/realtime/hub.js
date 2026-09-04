/**
 * Realtime hub — a thin WebSocket fan-out for live operational updates.
 *
 * Clients connect to  ws(s)://<host>/ws?token=<jwt>&companyId=<id>&branchId=<id>
 * and receive JSON events scoped to their company + branch:
 *
 *   { type: "trip:location", tripId, lat, lng, speedKph, heading, recordedAt }
 *   { type: "trip:status",   tripId, status, from }
 *
 * It is a broadcast channel only — the server never reads messages from clients.
 * If the WS server isn't running (tests, or `ws` missing) publish() is a no-op,
 * so nothing else in the codebase has to care whether realtime is available.
 */
import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";

let wss = null;
const clients = new Set(); // { ws, companyId, branchId, userId }

export function attachRealtime(server) {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    let params;
    try {
      params = new URL(req.url, "http://localhost").searchParams;
    } catch {
      ws.close(4000, "bad request");
      return;
    }

    let payload;
    try {
      payload = jwt.verify(params.get("token") || "", process.env.JWT_SECRET);
    } catch {
      ws.close(4001, "invalid token");
      return;
    }
    // staff tokens only — driver tokens carry kind:"driver" and no userId
    if (payload.kind === "driver" || !payload.userId) {
      ws.close(4003, "not permitted");
      return;
    }

    const client = {
      ws,
      userId: Number(payload.userId),
      companyId: Number(params.get("companyId")) || null,
      branchId: Number(params.get("branchId")) || null,
    };
    clients.add(client);
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("close", () => clients.delete(client));
    ws.on("error", () => clients.delete(client));

    safeSend(ws, { type: "hello", ts: Date.now() });
  });

  // drop dead sockets so a broken client can't wedge the set
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (c.ws.isAlive === false) {
        try { c.ws.terminate(); } catch { /* ignore */ }
        clients.delete(c);
        continue;
      }
      c.ws.isAlive = false;
      try { c.ws.ping(); } catch { /* ignore */ }
    }
  }, 30000);
  wss.on("close", () => clearInterval(heartbeat));

  console.log("[realtime] WebSocket server listening on /ws");
}

function safeSend(ws, obj) {
  if (ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
  }
}

/**
 * Broadcast an event to every connected client in the given company + branch.
 * A client with a null company/branch scope receives everything (rare — only
 * if it connected without those query params).
 */
export function publish(companyId, branchId, event) {
  if (!wss || !clients.size) return;
  const cId = companyId != null ? Number(companyId) : null;
  const bId = branchId != null ? Number(branchId) : null;
  for (const c of clients) {
    if (c.companyId != null && cId != null && c.companyId !== cId) continue;
    if (c.branchId != null && bId != null && c.branchId !== bId) continue;
    safeSend(c.ws, event);
  }
}
