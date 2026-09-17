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
