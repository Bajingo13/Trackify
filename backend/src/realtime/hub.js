/**
 * Realtime hub — a thin WebSocket fan-out for live operational updates.
 *
 * Clients first exchange their REST session for a one-minute realtime ticket,
 * then connect to ws(s)://<host>/ws?ticket=<realtime-ticket>.
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
import db from "../config/db.js";
import { verifyRealtimeTicket } from "./ticket.js";
import {
  hasPermissionInScope,
  isSystemAdministrator,
} from "../shared/accessCheck.js";

let wss = null;
const clients = new Set(); // { ws, companyId, branchId, userId, canReadTrips, canTrack }

export class RealtimeAuthorizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RealtimeAuthorizationError";
    this.code = code;
  }
}

function positiveId(value) {
  if (value == null || value === "") return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function realtimeScopeMatches(client, companyId, branchId) {
  const eventCompanyId = positiveId(companyId);
  const eventBranchId = positiveId(branchId);
  if (!eventCompanyId || !eventBranchId) return false;
  return client.companyId === eventCompanyId
    && (client.branchId == null || client.branchId === eventBranchId);
}

/**
 * Authorize the scope before a socket joins the fan-out set.
 *
 * Both company and branch are required and come from the signed ticket. The
 * current database grants are rechecked so disabling an account, access row,
 * or role takes effect on the next connection even if its REST token is live.
 */
export async function authorizeRealtimeScope(payload, _params, runner = db) {
  if (payload?.kind === "driver" || !positiveId(payload?.userId)) {
    throw new RealtimeAuthorizationError(4003, "not permitted");
  }

  const userId = positiveId(payload.userId);
  // Scope comes only from the signed ticket. Query-string company/branch values
  // are ignored, so a caller cannot widen or redirect a valid ticket.
  const companyId = positiveId(payload.companyId);
  const rawBranchId = payload.branchId;
  const branchId = positiveId(rawBranchId);

  if (!companyId || !branchId) {
    throw new RealtimeAuthorizationError(4002, "valid scope required");
  }

  const [userRows] = await runner.execute(
    "SELECT user_id FROM users WHERE user_id = ? AND status = 'active' LIMIT 1",
    [userId]
  );
  if (!userRows.length) {
    throw new RealtimeAuthorizationError(4003, "not permitted");
  }

  const [scopeRows] = await runner.execute(
    `SELECT b.branch_id
       FROM branches b
       JOIN companies c ON c.company_id = b.company_id
      WHERE b.branch_id = ? AND b.company_id = ?
        AND b.status = 'active' AND c.status = 'active'
      LIMIT 1`,
    [branchId, companyId]
  );
  if (!scopeRows.length) {
    throw new RealtimeAuthorizationError(4003, "not permitted");
  }

  const systemAdmin = await isSystemAdministrator(runner, userId);
  let canReadTrips = systemAdmin;
  let canTrack = systemAdmin;
  if (!systemAdmin) {
    const [accessRows] = await runner.execute(
      `SELECT access_id
         FROM user_company_access
        WHERE user_id = ? AND company_id = ? AND status = 'active'
          AND (branch_id = ? OR branch_id IS NULL)
          AND (effective_from IS NULL OR effective_from <= NOW())
          AND (effective_to IS NULL OR effective_to >= NOW())
        LIMIT 1`,
      [userId, companyId, branchId]
    );
    if (!accessRows.length) {
      throw new RealtimeAuthorizationError(4003, "not permitted");
    }

    [canReadTrips, canTrack] = await Promise.all([
      hasPermissionInScope(
        runner,
        { userId, companyId, branchId },
        "trip.read"
      ),
      hasPermissionInScope(
        runner,
        { userId, companyId, branchId },
        "tracking.read"
      ),
    ]);
    if (!canReadTrips && !canTrack) {
      throw new RealtimeAuthorizationError(4003, "not permitted");
    }
  }

  return { userId, companyId, branchId, canReadTrips, canTrack };
}

export function attachRealtime(server) {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", async (ws, req) => {
    let params;
    try {
      params = new URL(req.url, "http://localhost").searchParams;
    } catch {
      ws.close(4000, "bad request");
      return;
    }

    let payload;
    try {
      payload = verifyRealtimeTicket(params.get("ticket") || "");
    } catch {
      ws.close(4001, "invalid realtime ticket");
      return;
    }
    let scope;
    try {
      scope = await authorizeRealtimeScope(payload, params);
    } catch (error) {
      if (error instanceof RealtimeAuthorizationError) {
        ws.close(error.code, error.message);
      } else {
        console.error("[realtime] authorization failed", error);
        ws.close(1011, "authorization failed");
      }
      return;
    }
    if (ws.readyState !== 1) return;

    const client = { ws, ...scope };
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
  // The heartbeat should not keep a drained process (or an integration test)
  // alive after the HTTP server has stopped accepting work.
  heartbeat.unref?.();
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
 * Event type permissions are checked separately after tenant + branch scope.
 */
export function publish(companyId, branchId, event) {
  if (!wss || !clients.size) return;
  // Never let an unscoped publisher fail open into another tenant or branch.
  // Every current realtime event is owned by a concrete operating branch.
  for (const c of clients) {
    if (!realtimeScopeMatches(c, companyId, branchId)) continue;
    if (!canReceiveRealtimeEvent(c, event)) continue;
    safeSend(c.ws, event);
  }
}

/** Fail closed for new event types until their required permission is explicit. */
export function canReceiveRealtimeEvent(client, event) {
  if (event?.type === "trip:location") return client.canTrack === true;
  if (event?.type === "trip:status") {
    return client.canReadTrips === true || client.canTrack === true;
  }
  if (event?.type === "trip:stop") {
    return client.canReadTrips === true;
  }
  return false;
}
