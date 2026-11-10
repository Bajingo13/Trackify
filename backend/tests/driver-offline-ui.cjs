/**
 * Proves the driver app survives a dead zone.
 *
 * Signs in and opens a trip, drops the browser to offline via the DevTools
 * protocol, and checks the trip stays up, "No Connection" shows, and
 * an expense claim cannot be sent (nor is it parked: office-facing work needs
 * the internet). Restores the network and checks the bar clears only after the
 * server answers and the claim then goes. Last, a high-latency link shows the
 * slow-connection notice once, not on every probe.
 */
const WebSocket = require("ws");
const path = require("path");
const { spawn } = require("child_process");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const mysql = require("mysql2/promise");

const ORIGIN = "http://localhost:8443";
const API = "http://localhost:5000";
const PORT = 9466;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const RECEIPT = path.resolve(__dirname, "receipt.png");
// a trip the driver below is on and can still add expenses to
const FIXTURE = process.env.TRACKIFY_TEST_TRIP || "DVO-2026-0022";
const MARKER = "OR-OFFLINE-1";
// The seeded demo PIN. A dev database where the office has since set a new one
// passes it in, rather than the test resetting a real driver's PIN.
const DRIVER = process.env.TRACKIFY_TEST_DRIVER || "DRV-001";
const DRIVER_PIN = process.env.TRACKIFY_TEST_DRIVER_PIN || "1234";
let arrangedUpdatedAt = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log(`ok    ${n}`); } else { fail++; console.log(`FAIL  ${n} ${x}`); } };

const db = () => mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT) || 3306,
});

async function arrange() {
  const c = await db();
  const [[row]] = await c.execute("SELECT updated_at FROM trip_tickets WHERE ticket_no = ?", [FIXTURE]);
  await c.execute("UPDATE trip_tickets SET updated_at = NOW() WHERE ticket_no = ?", [FIXTURE]);
  await c.end();
  return row ? row.updated_at : null;
}
async function restore(original) {
  const c = await db();
  if (original) await c.execute("UPDATE trip_tickets SET updated_at = ? WHERE ticket_no = ?", [original, FIXTURE]);
  await c.execute("DELETE FROM trip_expenses WHERE receipt_no = ?", [MARKER]);
  await c.end();
}

/*
 * A fresh browser is a phone the system has never seen, and sign-in would wait
 * for an emailed code. Trust the shared test phone instead (_context.mjs), which
 * leaves a driver who already has a real trusted phone untouched.
 */
async function testPhone() {
  const { trustTestPhone } = await import("./_context.mjs");
  const c = await db();
  try { return await trustTestPhone(c, DRIVER); } finally { await c.end(); }
}

async function main() {
  const phone = await testPhone();
  if (phone.missing) { console.error(phone.missing); process.exitCode = 2; return; }
  arrangedUpdatedAt = await arrange();
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, "--headless=new", "--disable-gpu", "--hide-scrollbars",
    `--user-data-dir=${process.env.TEMP}/offqa-${Date.now()}`, "--window-size=430,900", "about:blank",
  ], { stdio: "ignore" });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* waiting */ }
  }
  if (!target) throw new Error("chrome did not start");

  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => ws.on("open", r));
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? rej(new Error(method + ": " + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evalJs = async (e, awaitPromise = false) => {
    const r = await send("Runtime.evaluate", { expression: e, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const setOffline = (offline) => send("Network.emulateNetworkConditions", {
    offline, latency: 0, downloadThroughput: offline ? 0 : -1, uploadThroughput: offline ? 0 : -1,
  });

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("DOM.enable");

  // ---- sign in and open the trip while still online ----
  await send("Page.navigate", { url: ORIGIN + "/driver" });
  await sleep(1500);
  // the key driverApi.js sends as X-Driver-Device
  await evalJs(`localStorage.setItem("ttms_driver_device", ${JSON.stringify(phone.key)})`);
  await send("Page.reload");
  await sleep(2500);
  await evalJs(`
    (function () {
      const set = (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const i = [...document.querySelectorAll("input")];
      set(i[0], ${JSON.stringify(DRIVER)}); set(i[1], ${JSON.stringify(DRIVER_PIN)});
      const b = [...document.querySelectorAll("button")].find(x => /sign in|log ?in|continue/i.test(x.textContent));
      if (b) b.click();
      return 1;
    })()
  `);
  await sleep(3000);
  // A driver who has not accepted the current Agreement sees it first. Accept
  // stays disabled until the text is scrolled to the end, as for a driver.
  if (await evalJs(`/I have read and accept/.test(document.body.innerText)`)) {
    await evalJs(`(function(){
      document.querySelectorAll("*").forEach((el) => { if (el.scrollHeight > el.clientHeight) { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll")); } });
      return 1;
    })()`);
    await sleep(400);
    await evalJs(`(function(){const b=[...document.querySelectorAll("button")].find(x=>/I have read and accept/.test(x.textContent)); if(b) b.click(); return 1;})()`);
    await sleep(2500);
  }
  await evalJs(`(function(){
    const c=[...document.querySelectorAll("button.dr-current, button.dr-row, .dr-card")]
      .find(x=>/DVO-|TT-/.test(x.innerText));
    if(c) c.click();
    return 1;
  })()`);
  await sleep(2600);
  check("trip screen is open", await evalJs(`/Expenses/.test(document.body.innerText)`) === true);

  // ---- go offline ----
  await setOffline(true);
  await evalJs(`window.dispatchEvent(new Event("offline"))`);
  await sleep(1200);
  check("No Connection is shown", await evalJs(`/No Connection/.test(document.body.innerText)`) === true,
    (await evalJs(`document.body.innerText.slice(0,160).replace(/\\s+/g," ")`)));
  check("the trip stays on screen offline", await evalJs(`/Expenses/.test(document.body.innerText)`) === true);

  // ---- an expense claim cannot go to the office offline ----
  await evalJs(`(function(){const b=[...document.querySelectorAll("button")].find(x=>/add an expense/i.test(x.textContent)); if(b) b.click(); return 1;})()`);
  await sleep(800);
  const doc = await send("DOM.getDocument");
  const fileNode = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "input[type=file]" });
  if (fileNode.nodeId) await send("DOM.setFileInputFiles", { files: [RECEIPT], nodeId: fileNode.nodeId });
  await sleep(400);
  await evalJs(`
    (function () {
      const set = (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const fuel = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Fuel");
      if (fuel) fuel.click();
      const n = document.querySelector("input[type=number]");
      if (n) set(n, "640.50");
      const or = [...document.querySelectorAll("input")].find(i => /OR-/i.test(i.placeholder || ""));
      if (or) set(or, ${JSON.stringify(MARKER)});
      return 1;
    })()
  `);
  await sleep(300);
  const submitState = `(function(){const b=[...document.querySelectorAll("button")].find(x=>/submit claim/i.test(x.textContent)); return b ? (b.disabled ? "disabled" : "enabled") : "missing";})()`;
  check("Submit claim is disabled offline", await evalJs(submitState) === "disabled", await evalJs(submitState));
  check("the driver is told it needs the internet", await evalJs(`/needs the internet/.test(document.body.innerText)`) === true);

  const outbox = () => evalJs(`
    new Promise((resolve) => {
      const r = indexedDB.open("trackify-driver", 1);
      r.onsuccess = () => {
        // no outbox store (the app never got past sign-in) would otherwise hang the run
        try {
          const q = r.result.transaction("outbox", "readonly").objectStore("outbox").getAll();
          q.onsuccess = () => resolve(q.result.filter((x) => x.kind !== "ping").length);
          q.onerror = () => resolve(-1);
        } catch { resolve(-1); }
      };
      r.onerror = () => resolve(-1);
    })
  `, true);
  check("nothing office-facing was parked on the phone", await outbox() === 0);
  const before = await countOnServer();
  check("nothing reached the server while offline", before === 0, `found=${before}`);

  // ---- back online: confirmed by the probe, then the claim can go ----
  await setOffline(false);
  await evalJs(`window.dispatchEvent(new Event("online"))`);
  await sleep(3000);
  check("No Connection clears once the server answers", await evalJs(`/No Connection/.test(document.body.innerText)`) === false);
  check("Submit claim is enabled again", await evalJs(submitState) === "enabled", await evalJs(submitState));
  check("the typed amount was kept", await evalJs(`document.querySelector("input[type=number]")?.value`) === "640.50");
  await evalJs(`(function(){const b=[...document.querySelectorAll("button")].find(x=>/submit claim/i.test(x.textContent)); if(b) b.click(); return 1;})()`);
  await sleep(2500);
  const after = await countOnServer();
  check("the claim reached the server once online", after === 1, `found=${after}`);

  // ---- slow link: one warning, and the screen keeps working ----
  await send("Network.emulateNetworkConditions", { offline: false, latency: 3200, downloadThroughput: -1, uploadThroughput: -1 });
  await evalJs(`window.dispatchEvent(new Event("online"))`); // nudges the probe now rather than in 30s
  await sleep(5000);
  check("a slow link shows the Slow Connection sign", await evalJs(`/Slow Connection/.test(document.body.innerText)`) === true);
  check("the screen still works on a slow link", await evalJs(`/No Connection/.test(document.body.innerText)`) === false);
  await sleep(6500); // the notice hides itself
  await evalJs(`window.dispatchEvent(new Event("online"))`); // same slow link, probed again
  await sleep(4500);
  check("the slow notice does not repeat while the link stays slow", await evalJs(`/Slow Connection/.test(document.body.innerText)`) === false);
  await setOffline(false);

  await restore(arrangedUpdatedAt);
  arrangedUpdatedAt = null;
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  ws.close(); chrome.kill();
  await sleep(250);
  process.exitCode = fail ? 1 : 0;
}

async function countOnServer() {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "financeofficer@gmail.com", password: "demo123" }),
  });
  const j = await r.json(); const a = j.data.access?.find((x) => x.branch_id) || j.data.access?.[0] || {};
  const H = { Authorization: `Bearer ${j.data.token}`, "X-Company-Id": String(a.company_id ?? ""), "X-Branch-Id": String(a.branch_id ?? "") };
  const list = await (await fetch(`${API}/api/v1/finance/expenses?status=submitted`, { headers: H })).json();
  return (list.data || []).filter((e) => e.receiptNo === MARKER).length;
}

// A run stopped from outside (Ctrl+C, a timeout) still puts the fixture back:
// on 21 Oct and again on 29 Oct a killed run left the trip's updated_at changed.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (arrangedUpdatedAt) {
      try { await restore(arrangedUpdatedAt); } catch { /* exiting anyway */ }
    }
    process.exit(130);
  });
}

main().catch(async (e) => {
  if (arrangedUpdatedAt) {
    try { await restore(arrangedUpdatedAt); } catch { /* retain the original error */ }
  }
  console.error("ERR", e.message);
  process.exitCode = 2;
});
