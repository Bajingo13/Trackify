/**
 * Browser-driven UI QA for Trackify.
 *
 * Drives the real dev app over the Chrome DevTools Protocol: signs in as a
 * staff user, walks every route, and on each one records page exceptions,
 * console errors and failed API calls. Then opens each page's primary action
 * (modals/forms) and closes it again, so the crawl exercises buttons rather
 * than just rendering.
 *
 *   node ui-qa.cjs [--role superadmin] [--out report.json]
 */
const WebSocket = require("d:/Trackify/ttms_system/backend/node_modules/ws");
const fs = require("fs");
const { spawn } = require("child_process");

const ORIGIN = "http://localhost:8443";
const API = "http://localhost:5000";
const PORT = 9444;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};
const ROLE = arg("--role", "superadmin");
const OUT = arg("--out", null);

const ROUTES = [
  "/dashboard",
  "/operations/trips", "/operations/dispatch", "/operations/live-tracking", "/operations/exceptions",
  "/fleet/vehicles", "/fleet/drivers", "/fleet/maintenance", "/fleet/availability", "/fleet/compliance",
  "/warehouse/inventory", "/warehouse/stock-movements", "/warehouse/transfers",
  "/warehouse/cargo-release", "/warehouse/cargo-return",
  "/finance/trip-expenses", "/finance/expense-vouchers", "/finance/invoices",
  "/finance/journal-entries", "/finance/bir-eis",
  "/master-data/customers", "/master-data/suppliers", "/master-data/items",
  "/master-data/warehouses", "/master-data/chart-of-accounts", "/master-data/tax-codes",
  "/reports/operations", "/reports/fleet", "/reports/expenses", "/reports/financial", "/reports/compliance",
  "/admin/companies", "/admin/branches", "/admin/users", "/admin/roles",
  "/admin/integrations", "/admin/settings", "/admin/audit-logs",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// noise we do not want to fail a route on
const IGNORE_CONSOLE = [
  /Download the React DevTools/i,
  /React Router Future Flag/i,
  /favicon/i,
  /MapLibre|maplibre/i,
  /WebGL|webgl/i,
  /Failed to load resource.*openfreemap/i,
];
const IGNORE_URL = [/openfreemap/i, /osrm/i, /nominatim/i, /tile/i, /favicon/i, /\/ws$/];

async function main() {
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--user-data-dir=${process.env.TEMP}/uiqa-${Date.now()}`,
    "--window-size=1600,1000",
    "about:blank",
  ], { stdio: "ignore" });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page");
    } catch { /* not up */ }
  }
  if (!target) throw new Error("chrome did not start");

  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0;
  const pending = new Map();

  // per-route collectors
  let bucket = { errors: [], console: [], net: [] };

  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }

    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      const text = String((d.exception && d.exception.description) || d.text || "").split("\n")[0];
      bucket.errors.push(text.slice(0, 240));
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      const text = m.params.args.map((a) => a.description || a.value).join(" ").slice(0, 240);
      if (!IGNORE_CONSOLE.some((re) => re.test(text))) bucket.console.push(text);
    }
    if (m.method === "Network.responseReceived") {
      const { url, status } = m.params.response;
      if (status >= 400 && url.includes("/api/") && !IGNORE_URL.some((re) => re.test(url))) {
        bucket.net.push(`${status} ${url.replace(API, "")}`);
      }
    }
    if (m.method === "Network.loadingFailed") {
      const url = m.params.request?.url || "";
      if (url.includes("/api/") && !IGNORE_URL.some((re) => re.test(url))) {
        bucket.net.push(`FAILED ${url.replace(API, "")} ${m.params.errorText}`);
      }
    }
  });

  await new Promise((res) => ws.on("open", res));
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, (m) => (m.error ? rej(new Error(method + ": " + m.error.message)) : res(m.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  const evalJs = async (expression, awaitPromise = false) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  // ---- sign in ----
  await send("Page.navigate", { url: ORIGIN + "/login" });
  await sleep(2500);
  const auth = await evalJs(`
    (async () => {
      const r = await fetch(${JSON.stringify(API)} + "/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: ${JSON.stringify(ROLE + "@gmail.com")}, password: "demo123" }),
      });
      const j = await r.json();
      if (!r.ok) return "FAIL " + JSON.stringify(j);
      const d = j.data;
      const u = { ...d.user, token: d.token, access: d.access || [], roles: d.roles || [], permissions: d.permissions || [] };
      localStorage.setItem("ttms_auth", JSON.stringify(u));
      const f = u.access[0];
      if (f) {
        localStorage.setItem("ttms_company_id", f.company_id);
        if (f.branch_id) localStorage.setItem("ttms_branch_id", f.branch_id);
      }
      return "OK " + (u.permissions || []).length + " perms";
    })()
  `, true);
  if (String(auth).startsWith("FAIL")) throw new Error("login failed: " + auth);
  console.log(`signed in as ${ROLE} — ${auth}\n`);

  const results = [];

  for (const route of ROUTES) {
    bucket = { errors: [], console: [], net: [] };

    await send("Page.navigate", { url: ORIGIN + route });
    await sleep(3200);

    const info = await evalJs(`
      (function () {
        const main = document.querySelector("main") || document.body;
        const text = (main.innerText || "").trim();
        const btns = [...document.querySelectorAll("button:not([disabled])")]
          .map(b => (b.textContent || "").trim()).filter(Boolean);
        return JSON.stringify({
          path: location.pathname,
          chars: text.length,
          rows: document.querySelectorAll("tbody tr").length,
          buttons: btns.length,
          firstButtons: btns.slice(0, 40),
          denied: /don't have permission|not authorized|access denied/i.test(text),
          blank: text.length < 40,
        });
      })()
    `);
    const page = JSON.parse(info);

    // exercise the page's primary action, then back out of it
    let clicked = null;
    const primary = await evalJs(`
      (function () {
        const wanted = /^(add|new|record|create|register|issue|receive|release|generate|post)\\b/i;
        const b = [...document.querySelectorAll("button:not([disabled])")]
          .find(x => wanted.test((x.textContent || "").trim()));
        if (!b) return null;
        const label = b.textContent.trim();
        b.click();
        return label;
      })()
    `);
    if (primary) {
      await sleep(1600);
      const opened = await evalJs(`
        (function () {
          const modal = document.querySelector(".ops-modal, [role=dialog], form");
          return modal ? (modal.querySelectorAll("input, select, textarea").length) : -1;
        })()
      `);
      // close it again
      await evalJs(`
        (function () {
          const c = [...document.querySelectorAll("button")]
            .find(x => /^(cancel|close)$/i.test((x.textContent || "").trim()));
          if (c) { c.click(); return "closed"; }
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          return "esc";
        })()
      `);
      await sleep(800);
      clicked = { label: primary, fields: opened };
    }

    const problems = [
      ...bucket.errors.map((e) => `EXCEPTION ${e}`),
      ...bucket.console.map((e) => `CONSOLE ${e}`),
      ...bucket.net.map((e) => `API ${e}`),
    ];
    if (page.blank && !page.denied) problems.push("BLANK page rendered no content");
    if (page.path !== route) problems.push(`REDIRECTED to ${page.path}`);

    results.push({ route, ...page, clicked, problems });

    const mark = problems.length ? "FAIL" : page.denied ? "deny" : "ok  ";
    const detail = [
      `${String(page.chars).padStart(5)} chars`,
      `${String(page.rows).padStart(3)} rows`,
      `${String(page.buttons).padStart(3)} btns`,
      clicked ? `opened "${clicked.label}" (${clicked.fields} fields)` : "no primary action",
    ].join("  ");
    console.log(`${mark}  ${route.padEnd(30)} ${detail}`);
    for (const p of problems) console.log(`        ! ${p}`);
  }

  const failed = results.filter((r) => r.problems.length);
  console.log(`\n==== ${results.length - failed.length}/${results.length} routes clean ====`);
  if (failed.length) {
    console.log("\nRoutes with problems:");
    for (const f of failed) console.log(`  ${f.route}\n    ${f.problems.join("\n    ")}`);
  }

  if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2));

  ws.close();
  chrome.kill();
  await sleep(250);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => { console.error("ERR", e.message); process.exit(2); });
