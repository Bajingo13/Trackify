/**
 * Realtime hub — a thin WebSocket fan-out for live operational updates.
 *
 * Clients first exchange their REST session for a one-minute realtime ticket,
 * then connect to ws(s)://<host>/ws?ticket=<realtime-ticket>.
 * and receive JSON events scoped to their company + branch:
 *
 *   { type: "trip:location", tripId, lat, lng, speedKph, heading, recordedAt }
 *   { type: "trip:status",   tripId, status, from }
 *   { type: "trip:message",  tripId, message }   (trip chat; see modules/chat)
 *
 * Driver App sockets connect the same way with a driver ticket and are kept
 * apart: they never join the branch-wide stream above, and receive only what
 * publishToDriver() addresses to that one driver —
 *
 *   { type: "chat:message", channel: "trip" | "support", tripId?, ticketId?, ... }
 *   { type: "trip:pause",   tripId, status }
 *
 * It is a broadcast channel only — the server never reads messages from clients.
 * If the WS server isn't running (tests, or `ws` missing) publish() is a no-op,
 * so nothing else in the codebase has to care whether realtime is available.
 */
import { WebSocketServer } from "ws";
import db from "../config/db.js";
import { verifyDriverRealtimeTicket, verifyRealtimeTicket } from "./ticket.js";
import { checkCompanyLicense } from "../shared/license.js";
import {
  hasPermissionInScope,
  isSystemAdministrator,
} from "../shared/accessCheck.js";

let wss = null;
const clients = new Set(); // { ws, companyId, branchId, userId, canReadTrips, canTrack, canReadSupport, canManageDevices }
const driverClients = new Set(); // { ws, driverId, companyId } — Driver App sockets, addressed one driver at a time

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
  if (!systemAdmin && !(await checkCompanyLicense(runner, companyId)).valid) {
    throw new RealtimeAuthorizationError(4003, "not permitted");
  }
  let canReadTrips = systemAdmin;
  let canTrack = systemAdmin;
  let canReadSupport = systemAdmin;
  let canManageDevices = systemAdmin;
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

    [canReadTrips, canTrack, canReadSupport, canManageDevices] = await Promise.all([
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
      hasPermissionInScope(
        runner,
        { userId, companyId, branchId },
        "support.read"
      ),
      hasPermissionInScope(
        runner,
        { userId, companyId, branchId },
        "driver.device.manage"
      ),
    ]);
    if (!canReadTrips && !canTrack && !canReadSupport && !canManageDevices) {
      throw new RealtimeAuthorizationError(4003, "not permitted");
    }
  }

  return { userId, companyId, branchId, canReadTrips, canTrack, canReadSupport, canManageDevices };
}

/**
 * A driver may hold a socket while they could sign in: active, app access on,
 * and their company licensed — the same test authenticateDriver applies to
 * every Driver App request. Rechecked on each connection.
 */
export async function authorizeDriverRealtime(payload, runner = db) {
  const driverId = positiveId(payload?.driverId);
  const companyId = positiveId(payload?.companyId);
  if (payload?.kind !== "driver" || !driverId || !companyId) {
    throw new RealtimeAuthorizationError(4003, "not permitted");
  }
  const [rows] = await runner.execute(
    "SELECT driver_id FROM drivers WHERE driver_id = ? AND company_id = ? AND status = 'active' AND app_enabled = 1 LIMIT 1",
    [driverId, companyId]
  );
  if (!rows.length) throw new RealtimeAuthorizationError(4003, "not permitted");
  // The phone the ticket was issued to must still be the driver's trusted one
  // (driver-app/devices.service.js); a ticket from a phone since signed out is refused.
  const deviceId = positiveId(payload?.deviceId);
  if (deviceId) {
    const [devices] = await runner.execute(
      "SELECT device_id FROM driver_devices WHERE device_id = ? AND driver_id = ? AND status = 'active' LIMIT 1",
      [deviceId, driverId]
    );
    if (!devices.length) throw new RealtimeAuthorizationError(4003, "not permitted");
  }
  if (!(await checkCompanyLicense(runner, companyId)).valid) {
    throw new RealtimeAuthorizationError(4003, "not permitted");
  }
  return deviceId ? { driverId, companyId, deviceId } : { driverId, companyId };
}

function joinDriver(ws, scope) {
  const client = { ws, ...scope };
  driverClients.add(client);
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("close", () => driverClients.delete(client));
  ws.on("error", () => driverClients.delete(client));
  safeSend(ws, { type: "hello", ts: Date.now() });
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
    const ticket = params.get("ticket") || "";
    try {
      payload = verifyRealtimeTicket(ticket);
    } catch {
      // Not a staff ticket: it may be a driver's, which joins the driver set only.
      let driverPayload;
      try {
        driverPayload = verifyDriverRealtimeTicket(ticket);
      } catch {
        ws.close(4001, "invalid realtime ticket");
        return;
      }
      try {
        const scope = await authorizeDriverRealtime(driverPayload);
        if (ws.readyState === 1) joinDriver(ws, scope);
      } catch (error) {
        if (error instanceof RealtimeAuthorizationError) ws.close(error.code, error.message);
        else {
          console.error(`[realtime] driver authorization failed: ${error?.code || error?.name || "error"}`);
          ws.close(1011, "authorization failed");
        }
      }
      return;
    }
    let scope;
    try {
      scope = await authorizeRealtimeScope(payload, params);
    } catch (error) {
      if (error instanceof RealtimeAuthorizationError) {
        ws.close(error.code, error.message);
      } else {
        // The code, not the object: see logFailure in middleware/errorHandler.js.
        console.error(`[realtime] authorization failed: ${error?.code || error?.name || "error"}`);
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
    for (const set of [clients, driverClients]) {
      for (const c of set) {
        if (c.ws.isAlive === false) {
          try { c.ws.terminate(); } catch { /* ignore */ }
          set.delete(c);
          continue;
        }
        c.ws.isAlive = false;
        try { c.ws.ping(); } catch { /* ignore */ }
      }
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

/**
 * Send an event to one driver's open Driver App sockets (a phone and a browser
 * may both be signed in). Company is matched as well as driver, so an event can
 * never cross tenants. Nothing else ever reaches a driver socket.
 */
export function publishToDriver(companyId, driverId, event) {
  if (!wss || !driverClients.size) return;
  const company = positiveId(companyId);
  const driver = positiveId(driverId);
  if (!company || !driver) return;
  for (const c of driverClients) {
    if (c.companyId === company && c.driverId === driver) safeSend(c.ws, event);
  }
}

/**
 * Close a driver's open sockets — they were deactivated, or their app access
 * withdrawn. A socket is authorized when it opens; this ends one that no longer
 * should be, rather than leaving it to hear the driver's events until the phone
 * next sleeps. (4003: the app does not try to reconnect after it.)
 */
export function disconnectDriver(companyId, driverId) {
  const company = positiveId(companyId);
  const driver = positiveId(driverId);
  if (!company || !driver) return;
  for (const c of driverClients) {
    if (c.companyId === company && c.driverId === driver) {
      try { c.ws.close(4003, "not permitted"); } catch { /* ignore */ }
      driverClients.delete(c);
    }
  }
}

/**
 * Close the sockets of particular phones of one driver — the ones that were
 * signed out or replaced — and leave the driver's trusted phone connected.
 * A socket that never said which phone it is closes too: it cannot be shown to
 * be the trusted one.
 */
export function disconnectDriverDevices(companyId, driverId, deviceIds) {
  const company = positiveId(companyId);
  const driver = positiveId(driverId);
  if (!company || !driver) return;
  const gone = new Set(deviceIds.map(Number));
  for (const c of driverClients) {
    if (c.companyId !== company || c.driverId !== driver) continue;
    if (c.deviceId && !gone.has(c.deviceId)) continue;
    try { c.ws.close(4003, "not permitted"); } catch { /* ignore */ }
    driverClients.delete(c);
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
  // What a driver says is read with the same right as where they are: tracking.
  if (event?.type === "trip:message") return client.canTrack === true;
  // A pause on a delivery matters to whoever watches the deliveries, and to whoever answers the driver.
  if (event?.type === "trip:pause") {
    return client.canTrack === true || client.canReadTrips === true || client.canReadSupport === true;
  }
  // A driver asking the office for help is read with the right to read those requests.
  if (event?.type === "support:ticket" || event?.type === "support:message") {
    return client.canReadSupport === true;
  }
  // A driver's new phone waiting for approval goes to whoever may approve it.
  if (event?.type === "driver:device_pending" || event?.type === "driver:device_resolved") {
    return client.canManageDevices === true;
  }
  return false;
}
