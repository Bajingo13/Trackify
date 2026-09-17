/**
 * Database-backed proof that the driver ping path reaches the correctly scoped
 * staff WebSocket. It uses an existing active demo trip and removes the single
 * tracking point it creates. A bare checkout without seeded tracking fixtures
 * skips cleanly, like the RBAC integration suite.
 */
import "../src/config/env.js";
import { createServer } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { WebSocket } from "ws";
import db from "../src/config/db.js";
import app from "../src/app.js";
import { ping } from "../src/modules/driver-app/driver.controller.js";
import { attachRealtime } from "../src/realtime/hub.js";

function waitForMessage(ws, type, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`Timed out waiting for ${type}`));
    }, timeoutMs);
    const onMessage = (raw) => {
      let value;
      try { value = JSON.parse(raw.toString()); } catch { return; }
      if (value?.type !== type) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(value);
    };
    ws.on("message", onMessage);
  });
}

function waitForClose(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for socket rejection")), timeoutMs);
    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    ws.once("error", () => {});
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("a scoped staff socket receives a driver ping from the trip branch", async (t) => {
  let trip;
  let staff;
  try {
    [[trip]] = await db.execute(
      `SELECT tt.trip_ticket_id, tt.company_id, tt.branch_id,
              ta.driver_id, ta.vehicle_id, d.home_branch_id
         FROM trip_tickets tt
         JOIN trip_assignments ta
           ON ta.trip_ticket_id = tt.trip_ticket_id AND ta.is_current = TRUE
         JOIN drivers d ON d.driver_id = ta.driver_id
        WHERE tt.status IN ('released', 'in_transit')
        ORDER BY tt.trip_ticket_id
        LIMIT 1`
    );
    [[staff]] = await db.execute(
      `SELECT u.user_id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.user_id AND ur.status = 'active'
         JOIN roles r ON r.role_id = ur.role_id AND r.status = 'active'
         JOIN role_permissions rp ON rp.role_id = r.role_id
         JOIN permissions p ON p.permission_id = rp.permission_id
        WHERE u.status = 'active' AND p.permission_code = 'system.admin'
        LIMIT 1`
    );
  } catch {
    await db.end();
    return t.skip("no database");
  }

  if (!trip || !staff || !process.env.JWT_SECRET) {
    await db.end();
    return t.skip("no seeded active trip or System Administrator fixture");
  }

  const server = createServer(app);
  attachRealtime(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const staffToken = jwt.sign({ userId: staff.user_id }, process.env.JWT_SECRET, { expiresIn: "2m" });
  const ticketResponse = await fetch(
    `http://127.0.0.1:${port}/api/v1/operations/tracking/realtime-ticket`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${staffToken}`,
        "Content-Type": "application/json",
        "X-Company-Id": String(trip.company_id),
        "X-Branch-Id": String(trip.branch_id),
      },
      body: "{}",
    }
  );
  const ticketBody = await ticketResponse.json();
  assert.equal(ticketResponse.status, 200);
  assert.match(ticketResponse.headers.get("cache-control") || "", /no-store/);
  assert.equal(typeof ticketBody.data?.ticket, "string");

  const query = new URLSearchParams({
    ticket: ticketBody.data.ticket,
    // These unsigned values are deliberately wrong: the server must use the
    // company/branch inside the signed ticket instead.
    companyId: "2147483647",
    branchId: "2147483646",
  });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${query}`);

  const markerLat = 14.590001;
  const markerLng = 120.980001;
  try {
    await waitForMessage(ws, "hello");

    const location = waitForMessage(ws, "trip:location");
    let statusCode;
    await ping(
      {
        params: { id: String(trip.trip_ticket_id) },
        body: { lat: markerLat, lng: markerLng },
        driver: {
          driverId: trip.driver_id,
          companyId: trip.company_id,
          branchId: trip.home_branch_id,
        },
      },
      {
        status(code) { statusCode = code; return this; },
        json() { return this; },
      }
    );

    const event = await location;
    assert.equal(statusCode, 201);
    assert.equal(Number(event.tripId), Number(trip.trip_ticket_id));
    assert.equal(Number(event.lat), markerLat);

    const [[stored]] = await db.execute(
      `SELECT branch_id
         FROM trip_tracking_points
        WHERE trip_ticket_id = ? AND driver_id = ?
          AND latitude = ? AND longitude = ?
        ORDER BY tracking_id DESC LIMIT 1`,
      [trip.trip_ticket_id, trip.driver_id, markerLat, markerLng]
    );
    assert.equal(Number(stored?.branch_id), Number(trip.branch_id));

    const staffAsTicket = new WebSocket(
      `ws://127.0.0.1:${port}/ws?${new URLSearchParams({ ticket: staffToken })}`
    );
    const staffRejected = await waitForClose(staffAsTicket);
    assert.equal(staffRejected.code, 4001);

    const driverToken = jwt.sign(
      { kind: "driver", driverId: trip.driver_id },
      process.env.JWT_SECRET,
      { expiresIn: "2m" }
    );
    const driverAsTicket = new WebSocket(
      `ws://127.0.0.1:${port}/ws?${new URLSearchParams({ ticket: driverToken })}`
    );
    const driverRejected = await waitForClose(driverAsTicket);
    assert.equal(driverRejected.code, 4001);

    const legacyTokenQuery = new WebSocket(
      `ws://127.0.0.1:${port}/ws?${new URLSearchParams({
        token: staffToken,
        companyId: String(trip.company_id),
        branchId: String(trip.branch_id),
      })}`
    );
    const legacyRejected = await waitForClose(legacyTokenQuery);
    assert.equal(legacyRejected.code, 4001);
  } finally {
    await db.execute(
      `DELETE FROM trip_tracking_points
        WHERE trip_ticket_id = ? AND driver_id = ?
          AND latitude = ? AND longitude = ?`,
      [trip.trip_ticket_id, trip.driver_id, markerLat, markerLng]
    );
    if (ws.readyState === WebSocket.OPEN) {
      await new Promise((resolve) => { ws.once("close", resolve); ws.close(); });
    }
    await closeServer(server);
    await db.end();
  }
});
