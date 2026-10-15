/**
 * Chat notifications, live, against a running backend.
 *
 * Dispatch writes in a run's chat: the driver's Driver App socket gets it at
 * once, it counts as unread until the driver reads it, and nobody else's
 * driver socket hears of it. The driver answers: the console's socket gets it,
 * and it counts as unread for the office until read. Driver sockets carry only
 * the driver's own events, and their tickets are not sign-in tokens.
 *
 * Uses DRV-001 (and DRV-002 for the "nobody else" check) and a run DRV-001 is
 * on. Removes every message it writes and puts the read markers back.
 */
import "../src/config/env.js";
import db from "../src/config/db.js";
import WebSocket from "ws";

const API = process.env.TRACKIFY_API_URL || "http://localhost:5000";
const WS = `${API.replace(/^http/, "ws")}/ws`;
let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log(`ok    ${n}`); } else { fail++; console.log(`FAIL  ${n} ${x}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const created = [];
const sockets = [];
let restoreReads = async () => {};
let missing = null;

async function json(path, { token, headers = {}, method = "GET", body } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/** Open a socket and collect what arrives on it. */
function listen(ticket) {
  return new Promise((resolve) => {
    const got = [];
    const ws = new WebSocket(`${WS}?ticket=${encodeURIComponent(ticket)}`);
    sockets.push(ws);
    ws.on("message", (raw) => { try { got.push(JSON.parse(raw)); } catch { /* ignore */ } });
    ws.on("close", (code) => { got.closed = code; });
    const ready = () => resolve({ ws, got });
    ws.on("open", () => setTimeout(ready, 150));
    ws.on("error", ready);
  });
}

const waitFor = async (got, test, ms = 3000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const hit = got.find(test);
    if (hit) return hit;
    await sleep(50);
  }
  return null;
};

async function main() {
  /* ---- fixture ---- */
  const d1 = await json("/api/v1/driver/auth/login", { method: "POST", body: { employeeNo: "DRV-001", pin: "1234" } });
  if (!d1.body.data?.token) { missing = `fixture missing: DRV-001 cannot sign in with the demo PIN (HTTP ${d1.status})`; return; }
  const driverToken = d1.body.data.token;
  const [[driver]] = await db.execute("SELECT driver_id AS id, company_id AS companyId FROM drivers WHERE employee_no = 'DRV-001'");
  const [[trip]] = await db.execute(
    `SELECT tt.trip_ticket_id AS id, tt.ticket_no AS ticketNo, tt.branch_id AS branchId
       FROM trip_assignments ta JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
      WHERE ta.driver_id = ? AND ta.is_current = TRUE AND tt.status IN ('assigned','accepted','released','in_transit','delivered')
      ORDER BY FIELD(tt.status,'in_transit','released','accepted','assigned','delivered') LIMIT 1`,
    [driver.id]
  );
  if (!trip) { missing = "fixture missing: DRV-001 has no run with an open chat"; return; }

  const staff = await json("/api/auth/login", { method: "POST", body: { email: "superadmin@gmail.com", password: "demo123" } });
  if (!staff.body.data?.token) { missing = `fixture missing: superadmin cannot sign in (HTTP ${staff.status})`; return; }
  const [[staffUser]] = await db.execute("SELECT user_id AS id FROM users WHERE email = 'superadmin@gmail.com'");
  const H = { "X-Company-Id": String(driver.companyId), "X-Branch-Id": String(trip.branchId) };
  const staffToken = staff.body.data.token;
  console.log(`      run ${trip.ticketNo}, driver DRV-001\n`);

  // put the read markers back as they were, whatever happens
  const [before] = await db.execute(
    `SELECT reader_kind, reader_id, last_read_message_id FROM trip_message_reads
      WHERE trip_ticket_id = ? AND ((reader_kind = 'driver' AND reader_id = ?) OR (reader_kind = 'staff' AND reader_id = ?))`,
    [trip.id, driver.id, staffUser.id]
  );
  restoreReads = async () => {
    for (const [kind, id] of [["driver", driver.id], ["staff", staffUser.id]]) {
      const was = before.find((r) => r.reader_kind === kind);
      if (was) {
        await db.execute("UPDATE trip_message_reads SET last_read_message_id = ? WHERE trip_ticket_id = ? AND reader_kind = ? AND reader_id = ?",
          [was.last_read_message_id, trip.id, kind, id]);
      } else {
        await db.execute("DELETE FROM trip_message_reads WHERE trip_ticket_id = ? AND reader_kind = ? AND reader_id = ?", [trip.id, kind, id]);
      }
    }
  };

  /* ---- tickets ---- */
  const t1 = await json("/api/v1/driver/realtime-ticket", { token: driverToken });
  check("a signed-in driver gets a live ticket", t1.status === 200 && typeof t1.body.data?.ticket === "string", `HTTP ${t1.status}`);
  const asLogin = await json("/api/v1/driver/me", { token: t1.body.data?.ticket });
  check("the ticket is not a sign-in token", asLogin.status === 401, `HTTP ${asLogin.status}`);
  const noAuth = await json("/api/v1/driver/realtime-ticket");
  check("no ticket without signing in", noAuth.status === 401, `HTTP ${noAuth.status}`);

  const bad = await listen("not-a-ticket");
  await sleep(300);
  check("a socket with a bad ticket is closed", bad.got.closed === 4001, `close=${bad.got.closed}`);

  const driverLive = await listen(t1.body.data.ticket);
  check("the driver's socket opens", driverLive.ws.readyState === WebSocket.OPEN);

  // another driver, to show they hear nothing of DRV-001's run
  let otherLive = null;
  const d2 = await json("/api/v1/driver/auth/login", { method: "POST", body: { employeeNo: "DRV-002", pin: "1234" } });
  if (d2.body.data?.token) {
    const t2 = await json("/api/v1/driver/realtime-ticket", { token: d2.body.data.token });
    otherLive = await listen(t2.body.data.ticket);
  } else {
    console.log("      (DRV-002 cannot sign in; skipping the other-driver check)");
  }

  const st = await json("/api/v1/operations/tracking/realtime-ticket", { token: staffToken, headers: H, method: "POST", body: {} });
  const staffLive = await listen(st.body.data?.ticket || "");
  check("the console's socket opens", staffLive.ws.readyState === WebSocket.OPEN, `ticket HTTP ${st.status}`);

  /* ---- dispatch writes: the driver is told at once ---- */
  const unreadBefore = (await json("/api/v1/driver/messages/unread", { token: driverToken })).body.data?.find((r) => r.tripId === trip.id)?.unread || 0;
  const text = `E2E notification check ${Date.now()}:   see  you at gate 3`;
  const sent = await json(`/api/v1/operations/chat/trips/${trip.id}`, { token: staffToken, headers: H, method: "POST", body: { body: text } });
  check("dispatch's message is saved", sent.status === 201, `HTTP ${sent.status} ${sent.body.message || ""}`);
  if (sent.body.data?.id) created.push(sent.body.data.id);

  const startedAt = Date.now();
  const live = await waitFor(driverLive.got, (m) => m.type === "chat:message" && m.messageId === sent.body.data?.id);
  check("the driver's app hears of it live", Boolean(live), JSON.stringify(driverLive.got).slice(0, 200));
  if (live) {
    console.log(`      arrived in ${Date.now() - startedAt} ms`);
    check("it says which run, and who wrote", live.channel === "trip" && live.tripId === trip.id && live.ticketNo === trip.ticketNo && Boolean(live.from));
    check("with a one-line preview of what was said", live.preview === text.replace(/\s+/g, " ").trim(), JSON.stringify(live.preview));
  }
  const unreadAfter = (await json("/api/v1/driver/messages/unread", { token: driverToken })).body.data?.find((r) => r.tripId === trip.id)?.unread || 0;
  check("it counts as unread for the driver (the bell)", unreadAfter === unreadBefore + 1, `${unreadBefore} -> ${unreadAfter}`);

  if (otherLive) {
    await sleep(300);
    check("another driver hears nothing of it", !otherLive.got.some((m) => m.type !== "hello"), JSON.stringify(otherLive.got));
  }

  /* ---- the driver reads it: it stops being unread ---- */
  const read = await json(`/api/v1/driver/trips/${trip.id}/messages/read`, { token: driverToken, method: "POST", body: { lastMessageId: sent.body.data?.id } });
  check("the driver marks it read", read.status === 200, `HTTP ${read.status}`);
  const unreadNow = (await json("/api/v1/driver/messages/unread", { token: driverToken })).body.data?.find((r) => r.tripId === trip.id)?.unread || 0;
  check("and it leaves the bell", unreadNow === 0, `unread=${unreadNow}`);

  /* ---- the driver answers: the office is told at once ---- */
  const staffUnreadBefore = (await json("/api/v1/operations/chat/unread", { token: staffToken, headers: H })).body.data?.find((r) => r.tripId === trip.id)?.unread || 0;
  const reply = await json(`/api/v1/driver/trips/${trip.id}/messages`, { token: driverToken, method: "POST", body: { body: `E2E reply ${Date.now()}` } });
  check("the driver's reply is saved", reply.status === 201 || reply.status === 200, `HTTP ${reply.status} ${reply.body.message || ""}`);
  if (reply.body.data?.id) created.push(reply.body.data.id);
  const heard = await waitFor(staffLive.got, (m) => m.type === "trip:message" && m.message?.id === reply.body.data?.id);
  check("the console hears of it live", Boolean(heard) && heard.message.senderKind === "driver");
  const staffUnread = (await json("/api/v1/operations/chat/unread", { token: staffToken, headers: H })).body.data?.find((r) => r.tripId === trip.id)?.unread || 0;
  check("it counts as unread for the office (the bell)", staffUnread === staffUnreadBefore + 1, `${staffUnreadBefore} -> ${staffUnread}`);
  check("the driver is not told of their own message", !driverLive.got.some((m) => m.type === "chat:message" && m.messageId === reply.body.data?.id));

  await json(`/api/v1/operations/chat/trips/${trip.id}/read`, { token: staffToken, headers: H, method: "POST", body: { lastMessageId: reply.body.data?.id } });
  const staffUnreadNow = (await json("/api/v1/operations/chat/unread", { token: staffToken, headers: H })).body.data?.find((r) => r.tripId === trip.id)?.unread || 0;
  check("read in the console, it leaves the office's bell", staffUnreadNow === 0, `unread=${staffUnreadNow}`);

  /* ---- the console's list of drivers' Help & Support messages ---- */
  const support = await json("/api/v1/operations/exceptions/driver-messages", { token: staffToken, headers: H });
  check("the console's bell can list drivers' Help & Support messages", support.status === 200 && Array.isArray(support.body.data), `HTTP ${support.status}`);
  const supportDriver = await json("/api/v1/driver/support/unread", { token: driverToken });
  check("the driver's bell can list the office's Help & Support replies", supportDriver.status === 200 && Array.isArray(supportDriver.body.data?.tickets), `HTTP ${supportDriver.status}`);

  /* ---- a driver socket carries only that driver's own events ---- */
  const kinds = new Set(driverLive.got.map((m) => m.type));
  kinds.delete("hello");
  check("nothing from the branch-wide stream reaches a driver socket", [...kinds].every((k) => k === "chat:message" || k === "trip:pause"), [...kinds].join(","));

  /* ---- app access withdrawn: the live line closes at once ---- */
  const [[access]] = await db.execute("SELECT app_enabled FROM drivers WHERE driver_id = ?", [driver.id]);
  if (access?.app_enabled) {
    const off = await json(`/api/v1/fleet/drivers/${driver.id}/app-access`, { token: staffToken, headers: H, method: "PATCH", body: { appEnabled: false } });
    try {
      await sleep(300);
      check("withdrawing app access closes the driver's live connection", off.status === 200 && driverLive.got.closed === 4003, `HTTP ${off.status}, close=${driverLive.got.closed}`);
    } finally {
      // put it back exactly as it was
      await db.execute("UPDATE drivers SET app_enabled = 1 WHERE driver_id = ?", [driver.id]);
    }
  }
}

try {
  await main();
} catch (error) {
  fail++;
  console.log(`FAIL  the suite stopped: ${error.message}`);
} finally {
  for (const ws of sockets) { try { ws.close(); } catch { /* ignore */ } }
  if (created.length) {
    await db.execute(`DELETE FROM trip_messages WHERE message_id IN (${created.map(() => "?").join(",")})`, created);
    console.log(`\n      removed the ${created.length} test message(s)`);
  }
  await restoreReads().catch(() => {});
  await db.end();
}

if (missing) {
  console.error(missing);
  process.exitCode = 2;
} else {
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exitCode = fail ? 1 : 0;
}
