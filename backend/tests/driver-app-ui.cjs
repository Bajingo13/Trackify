/**
 * Drives the driver app through a real browser: PIN sign-in, open a trip,
 * fill the expense form (including attaching a receipt file through the real
 * <input type=file>), submit, and confirm it comes back as awaiting review.
 */
const WebSocket = require("ws");
const path = require("path");
const { spawn } = require("child_process");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const mysql = require("mysql2/promise");

/**
 * The demo driver with a known PIN (DRV-001) has no active run, and a
 * delivered trip only stays visible for three days. Rather than depend on
 * whatever state the demo data is in, the test brings one of that driver's
 * delivered trips into the window, then puts the timestamp back afterwards.
 */
const FIXTURE_TICKET = "DVO-2026-0022";
async function db() {
  return mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT) || 3306,
  });
}
async function arrangeFixture() {
  const c = await db();
  const [[row]] = await c.execute("SELECT updated_at FROM trip_tickets WHERE ticket_no = ?", [FIXTURE_TICKET]);
  await c.execute("UPDATE trip_tickets SET updated_at = NOW() WHERE ticket_no = ?", [FIXTURE_TICKET]);
  await c.end();
  return row ? row.updated_at : null;
}
async function restoreFixture(original) {
  const c = await db();
  if (original) await c.execute("UPDATE trip_tickets SET updated_at = ? WHERE ticket_no = ?", [original, FIXTURE_TICKET]);
  await c.execute("DELETE FROM trip_expenses WHERE submitted_by_driver_id IS NOT NULL AND receipt_no = ?", ["OR-UIQA-1"]);
  await c.end();
}

const ORIGIN = process.env.DRV_ORIGIN || "http://localhost:8443";
const API = "http://localhost:5000";
const PORT = 9455;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const RECEIPT = path.resolve(__dirname, "receipt.png");
let arrangedUpdatedAt = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log(`ok    ${n}`); } else { fail++; console.log(`FAIL  ${n} ${x}`); } };

async function main() {
  arrangedUpdatedAt = await arrangeFixture();
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, "--headless=new", "--disable-gpu", "--hide-scrollbars",
    `--user-data-dir=${process.env.TEMP}/drvqa-${Date.now()}`, "--window-size=430,900", "about:blank",
  ], { stdio: "ignore" });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* not up */ }
  }
  if (!target) throw new Error("chrome did not start");

  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pending = new Map(); const errors = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") {
      errors.push(String(m.params.exceptionDetails?.exception?.description || "").split("\n")[0]);
    }
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

  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");

  // ---- 1. PIN sign-in through the real form ----
  await send("Page.navigate", { url: ORIGIN + "/driver" });
  await sleep(2500);

  const typed = await evalJs(`
    (function () {
      const set = (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const inputs = [...document.querySelectorAll("input")];
      if (inputs.length < 2) return "inputs:" + inputs.length;
      set(inputs[0], "DRV-001");
      set(inputs[1], "1234");
      const b = [...document.querySelectorAll("button")].find(x => /sign in|log ?in|continue/i.test(x.textContent));
      if (!b) return "no submit button";
      b.click();
      return "submitted";
    })()
  `);
  check("PIN form accepts credentials", typed === "submitted", String(typed));
  await sleep(3000);

  const home = await evalJs(`document.body.innerText.slice(0, 200).replace(/\\s+/g, " ")`);
  check("driver lands past the sign-in screen", !/enter your pin/i.test(home), home.slice(0, 90));

  // ---- 2. open a trip ----
  let screen = "";
  const opened = await evalJs(`
    (function () {
      // The current driver home uses a prominent current-trip button and
      // compact trip rows; keep the legacy selector for older deployments.
      const cards = [...document.querySelectorAll("button.dr-current, button.dr-row, .dr-card")];
      const c = cards.find(x => /DVO-|TT-/.test(x.innerText));
      if (!c) return "no trip cards";
      c.click();
      return "clicked";
    })()
  `);
  await sleep(2800);
  screen = await evalJs(`document.body.innerText.replace(/\\s+/g, " ").slice(0, 300)`);
  check("a trip opens from the list", opened === "clicked" && /Expenses|Share my location|Start trip|Stops/i.test(screen), `${opened} :: ${screen.slice(0, 110)}`);

  // ---- 3. expenses card present ----
  // read the document again: the expenses card mounts after its own fetch,
  // so a capture taken when the trip opened can predate it
  const withExpenses = await evalJs("document.body.innerText");
  check("expenses card is on the trip screen", /Expenses/.test(withExpenses), withExpenses.slice(0, 140));

  // ---- 4. open the form ----
  const formOpen = await evalJs(`
    (function () {
      const b = [...document.querySelectorAll("button")].find(x => /add an expense/i.test(x.textContent));
      if (!b) return "no add button";
      b.click();
      return "opened";
    })()
  `);
  check("expense form opens", formOpen === "opened", String(formOpen));
  await sleep(900);

  // ---- 5. category chips ----
  await evalJs(`(function(){const c=[...document.querySelectorAll(".dr-chip")].find(x=>/toll/i.test(x.textContent)); if(c) c.click(); return 1;})()`);
  await sleep(600);
  const chip = await evalJs(`
    (function () {
      const on = [...document.querySelectorAll(".dr-chip.on")].map(x => x.textContent.trim());
      return on.length === 1 ? on[0] : "on=" + JSON.stringify(on);
    })()
  `);
  check("category chips are selectable", chip === "Toll", String(chip));
  await evalJs(`(function(){const c=[...document.querySelectorAll(".dr-chip")].find(x=>/fuel/i.test(x.textContent)); if(c) c.click(); return 1;})()`);
  await sleep(400);

  // ---- 6. attach a real file ----
  const doc = await send("DOM.getDocument");
  const fileNode = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "input[type=file]" });
  check("form exposes a camera/file field", !!fileNode.nodeId);
  if (fileNode.nodeId) {
    await send("DOM.setFileInputFiles", { files: [RECEIPT], nodeId: fileNode.nodeId });
    await sleep(600);
    const shown = await evalJs(`/receipt\\.png/.test(document.body.innerText)`);
    check("attached file name is shown back", shown === true);
  }

  // ---- 7. validation ----
  await evalJs(`(function(){const b=[...document.querySelectorAll("button")].find(x=>/send for review/i.test(x.textContent)); if(b) b.click(); return 1;})()`);
  await sleep(900);
  check("submitting with no amount is refused", await evalJs(`/Enter how much you spent/i.test(document.body.innerText)`) === true);

  // ---- 8. fill and submit ----
  await evalJs(`
    (function () {
      const set = (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const nums = [...document.querySelectorAll("input[type=number]")];
      if (nums[0]) set(nums[0], "1875.25");
      const byPlaceholder = (re) => [...document.querySelectorAll("input")].find(i => re.test(i.placeholder || ""));
      const or = byPlaceholder(/OR-/i);
      const note = byPlaceholder(/diesel|top-up/i);
      if (or) set(or, "OR-UIQA-1");
      if (note) set(note, "UI QA diesel");
      return JSON.stringify({ or: !!or, note: !!note });
      return 1;
    })()
  `);
  await sleep(400);
  await evalJs(`(function(){const b=[...document.querySelectorAll("button")].find(x=>/send for review/i.test(x.textContent)); if(b) b.click(); return 1;})()`);
  await sleep(3200);

  const after = await evalJs(`document.body.innerText.replace(/\\s+/g, " ")`);
  check("claim is confirmed as sent", /Sent for review/i.test(after), after.slice(0, 140));
  check("claim lists its review state", /Waiting for review/i.test(after), after.slice(0, 200));
  check("claim shows the amount back", /1,875\.25/.test(after));
  check("no uncaught errors in the driver app", errors.length === 0, errors.join(" | "));

  // ---- 9. confirm it reached the backend ----
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "financeofficer@gmail.com", password: "demo123" }),
  });
  const j = await r.json(); const a = j.data.access?.find((x) => x.branch_id) || j.data.access?.[0] || {};
  const H = { Authorization: `Bearer ${j.data.token}`, "X-Company-Id": String(a.company_id ?? ""), "X-Branch-Id": String(a.branch_id ?? "") };
  const list = await (await fetch(`${API}/api/v1/finance/expenses?status=submitted`, { headers: H })).json();
  const row = (list.data || []).find((e) => Math.abs(e.amount - 1875.25) < 0.01);
  check("backend has the claim awaiting review", !!row);
  check("backend stored the receipt", (row?.attachments || []).length === 1);
  check("backend recorded which driver filed it", !!row?.submittedByDriver, String(row?.submittedByDriver));

  if (row) {
    await fetch(`${API}/api/v1/finance/expenses/${row.id}/reject`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ note: "UI QA cleanup" }),
    });
    const del = await fetch(`${API}/api/v1/finance/expenses/${row.id}`, { method: "DELETE", headers: H });
    check("cleanup: QA claim removed", del.ok, `status=${del.status}`);
  }

  await restoreFixture(arrangedUpdatedAt);
  arrangedUpdatedAt = null;

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  // let the socket and browser finish closing before exiting, otherwise
  // libuv prints a teardown assertion on Windows that reads like a failure
  ws.close();
  chrome.kill();
  await sleep(250);
  process.exitCode = fail ? 1 : 0;
}

main().catch(async (e) => {
  if (arrangedUpdatedAt) {
    try { await restoreFixture(arrangedUpdatedAt); } catch { /* retain the original error */ }
  }
  console.error("ERR", e.message);
  process.exit(2);
});
