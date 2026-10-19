import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

export const REALTIME_TICKET_TTL_SECONDS = 60;
export const REALTIME_TICKET_AUDIENCE = "trackify-realtime";
export const REALTIME_TICKET_ISSUER = "trackify-api";
const REALTIME_TICKET_KIND = "realtime_ticket";
const REALTIME_TICKET_PURPOSE = "realtime.subscribe";
const REALTIME_TICKET_SCOPE = "operations.events";

function positiveId(value, name) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return id;
}

/**
 * Mint a narrowly scoped, short-lived credential for the WebSocket handshake.
 * It deliberately has no `userId`, so the normal REST authentication middleware
 * cannot mistake it for a staff session token.
 */
export function issueRealtimeTicket(
  { userId, companyId, branchId },
  secret = process.env.JWT_SECRET
) {
  const normalizedUserId = positiveId(userId, "userId");
  const normalizedCompanyId = positiveId(companyId, "companyId");
  const normalizedBranchId = positiveId(branchId, "branchId");

  return jwt.sign(
    {
      kind: REALTIME_TICKET_KIND,
      purpose: REALTIME_TICKET_PURPOSE,
      scope: REALTIME_TICKET_SCOPE,
      companyId: normalizedCompanyId,
      branchId: normalizedBranchId,
    },
    secret,
    {
      algorithm: "HS256",
      audience: REALTIME_TICKET_AUDIENCE,
      issuer: REALTIME_TICKET_ISSUER,
      subject: String(normalizedUserId),
      jwtid: randomUUID(),
      expiresIn: REALTIME_TICKET_TTL_SECONDS,
    }
  );
}

export function verifyRealtimeTicket(token, secret = process.env.JWT_SECRET) {
  const payload = jwt.verify(token, secret, {
    algorithms: ["HS256"],
    audience: REALTIME_TICKET_AUDIENCE,
    issuer: REALTIME_TICKET_ISSUER,
  });

  if (
    payload?.kind !== REALTIME_TICKET_KIND ||
    payload?.purpose !== REALTIME_TICKET_PURPOSE ||
    payload?.scope !== REALTIME_TICKET_SCOPE ||
    typeof payload?.jti !== "string" ||
    !payload.jti ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > REALTIME_TICKET_TTL_SECONDS
  ) {
    throw new jwt.JsonWebTokenError("invalid realtime ticket");
  }

  return {
    userId: positiveId(payload.sub, "subject"),
    companyId: positiveId(payload.companyId, "companyId"),
    branchId: positiveId(payload.branchId, "branchId"),
  };
}

/*
 * Driver App tickets.
 *
 * A separate kind, purpose and scope from the staff ticket above, so neither
 * verifier can ever accept the other: a driver socket receives only events
 * addressed to that driver (publishToDriver in hub.js), never the branch-wide
 * operations stream.
 */
const DRIVER_TICKET_KIND = "driver_realtime_ticket";
const DRIVER_TICKET_SCOPE = "driver.events";

export function issueDriverRealtimeTicket({ driverId, companyId, deviceId }, secret = process.env.JWT_SECRET) {
  const normalizedDriverId = positiveId(driverId, "driverId");
  const normalizedCompanyId = positiveId(companyId, "companyId");
  // Which phone the socket belongs to, so signing one phone out closes only its socket.
  const device = deviceId != null ? { deviceId: positiveId(deviceId, "deviceId") } : {};
  return jwt.sign(
    { kind: DRIVER_TICKET_KIND, purpose: REALTIME_TICKET_PURPOSE, scope: DRIVER_TICKET_SCOPE, companyId: normalizedCompanyId, ...device },
    secret,
    {
      algorithm: "HS256",
      audience: REALTIME_TICKET_AUDIENCE,
      issuer: REALTIME_TICKET_ISSUER,
      subject: String(normalizedDriverId),
      jwtid: randomUUID(),
      expiresIn: REALTIME_TICKET_TTL_SECONDS,
    }
  );
}

export function verifyDriverRealtimeTicket(token, secret = process.env.JWT_SECRET) {
  const payload = jwt.verify(token, secret, {
    algorithms: ["HS256"],
    audience: REALTIME_TICKET_AUDIENCE,
    issuer: REALTIME_TICKET_ISSUER,
  });
  if (
    payload?.kind !== DRIVER_TICKET_KIND ||
    payload?.purpose !== REALTIME_TICKET_PURPOSE ||
    payload?.scope !== DRIVER_TICKET_SCOPE ||
    typeof payload?.jti !== "string" || !payload.jti ||
    !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) ||
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > REALTIME_TICKET_TTL_SECONDS
  ) {
    throw new jwt.JsonWebTokenError("invalid driver realtime ticket");
  }
  return {
    kind: "driver",
    driverId: positiveId(payload.sub, "subject"),
    companyId: positiveId(payload.companyId, "companyId"),
    ...(payload.deviceId != null ? { deviceId: positiveId(payload.deviceId, "deviceId") } : {}),
  };
}
