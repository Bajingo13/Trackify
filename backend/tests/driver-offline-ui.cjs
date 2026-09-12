/**
 * Proves the driver app survives a dead zone.
 *
 * Signs in, drops the browser to offline via the DevTools protocol, files an
 * expense, checks it was parked rather than lost, then restores the network
 * and confirms the outbox drains to the server on its own.
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
const FIXTURE = "DVO-2026-0022";
const MARKER = "OR-OFFLINE-1";

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

async function main() {
  const original = await arrange();
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
  await sleep(2500);
  await evalJs(`
    (function () {
      const set = (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const i = [...document.querySelectorAll("input")];
      set(i[0], "DRV-001"); set(i[1], "1234");
      const b = [...document.querySelectorAll("button")].find(x => /sign in|log ?in|continue/i.test(x.textContent));
      if (b) b.click();
      return 1;
    })()
  `);
  await sleep(3000);
  await evalJs(`(function(){const c=[...document.querySelectorAll(".dr-card")].find(x=>/DVO-|TT-/.test(x.innerText)); if(c) c.click(); return 1;})()`);
  await sleep(2600);
  check("trip screen is open", await evalJs(`/Expenses/.test(document.body.innerText)`) === true);

  // ---- go offline ----
  await setOffline(true);
  await evalJs(`window.dispatchEvent(new Event("offline"))`);
  await sleep(1200);
  check("app reports the lost signal", await evalJs(`/No signal/i.test(document.body.innerText)`) === true,
    (await evalJs(`document.body.innerText.slice(0,120).replace(/\\s+/g," ")`)));

  // ---- file an expense with no network ----
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
      const n = document.querySelector("input[type=number]");
      if (n) set(n, "640.50");
      const or = [...document.querySelectorAll("input")].find(i => /OR-/i.test(i.placeholder || ""));
      if (or) set(or, ${JSON.stringify(MARKER)});
      return 1;
    })()
  `);
  await sleep(300);
  await evalJs(`(function(){const b=[...document.querySelectorAll("button")].find(x=>/send for review/i.test(x.textContent)); if(b) b.click(); return 1;})()`);
  await sleep(2200);

  const queued = await evalJs(`
    new Promise((resolve) => {
      const r = indexedDB.open("trackify-driver", 1);
      r.onsuccess = () => {
        const q = r.result.transaction("outbox", "readonly").objectStore("outbox").getAll();
        q.onsuccess = () => resolve(q.result.length);
        q.onerror = () => resolve(-1);
      };
      r.onerror = () => resolve(-1);
    })
  `, true);
  check("the expense was saved on the phone, not lost", queued >= 1, `outbox=${queued}`);
  check("the driver is told it is saved", await evalJs(`/saved on this phone/i.test(document.body.innerText)`) === true);

  // the server must not have it yet
  const before = await countOnServer();
  check("nothing reached the server while offline", before === 0, `found=${before}`);

  // ---- back online: the outbox drains itself ----
  await setOffline(false);
  await evalJs(`window.dispatchEvent(new Event("online"))`);
  await sleep(4000);

  const after = await countOnServer();
  check("the saved expense reached the server on its own", after === 1, `found=${after}`);

  const drained = await evalJs(`
    new Promise((resolve) => {
      const r = indexedDB.open("trackify-driver", 1);
      r.onsuccess = () => {
        const q = r.result.transaction("outbox", "readonly").objectStore("outbox").getAll();
        q.onsuccess = () => resolve(q.result.length);
        q.onerror = () => resolve(-1);
      };
      r.onerror = () => resolve(-1);
    })
  `, true);
  check("the outbox is empty afterwards", drained === 0, `outbox=${drained}`);

  await restore(original);
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

main().catch(async (e) => { console.error("ERR", e.message); process.exitCode = 2; });
