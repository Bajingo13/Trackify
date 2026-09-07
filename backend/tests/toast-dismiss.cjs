/**
 * Does a toast actually go away on its own?
 *
 * Raises one, checks it is on screen, waits past the 3.5s dismissal window,
 * and checks it is gone. Then raises several in a row and confirms none of
 * them linger.
 */
const WebSocket = require("d:/Trackify/ttms_system/backend/node_modules/ws");
const { spawn } = require("child_process");

const ORIGIN = "http://localhost:8443";
const API = "http://localhost:5000";
const PORT = 9499;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (n, c, x = "") => { if (c) { pass++; console.log(`ok    ${n}`); } else { fail++; console.log(`FAIL  ${n} ${x}`); } };

async function main() {
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, "--headless=new", "--disable-gpu", "--hide-scrollbars",
    `--user-data-dir=${process.env.TEMP}/toast-${Date.now()}`, "--window-size=1400,900", "about:blank",
  ], { stdio: "ignore" });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* waiting */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => ws.on("open", r));
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evalJs = async (e, awaitPromise = false) => {
    const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  await send("Page.enable"); await send("Runtime.enable");

  // sign in, then land on a page that raises toasts
  await send("Page.navigate", { url: ORIGIN + "/login" });
  await sleep(2500);
  await evalJs(`
    (async () => {
      const r = await fetch("${API}/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "superadmin@gmail.com", password: "demo123" }),
      });
      const j = await r.json(); const d = j.data;
      const u = { ...d.user, token: d.token, access: d.access || [], roles: d.roles || [], permissions: d.permissions || [] };
      localStorage.setItem("ttms_auth", JSON.stringify(u));
      const f = u.access[0];
      if (f) { localStorage.setItem("ttms_company_id", f.company_id); if (f.branch_id) localStorage.setItem("ttms_branch_id", f.branch_id); }
      return 1;
    })()
  `, true);

  await send("Page.navigate", { url: ORIGIN + "/finance/trip-expenses" });
  await sleep(3500);

  const countToasts = () => evalJs(`document.querySelectorAll(".tk-toast").length`);

  // raise one by saving an expense unchanged
  await evalJs(`(function(){var g=document.querySelector(".tk-trip-group"); if(g) g.click(); return 1;})()`);
  await sleep(1000);
  await evalJs(`(function(){var b=[...document.querySelectorAll("button[title=Edit]")]; if(b[0]) b[0].click(); return b.length;})()`);
  await sleep(1400);
  await evalJs(`(function(){var f=document.querySelector("form"); if(f) f.requestSubmit(); return 1;})()`);
  await sleep(1200);

  const shown = await countToasts();
  check("a toast appears", shown >= 1, `count=${shown}`);

  // the dismissal window is 3.5s; give it room
  await sleep(4200);
  const afterWait = await countToasts();
  check("it dismisses itself", afterWait === 0, `still showing ${afterWait}`);

  // several in a row must all clear rather than stack forever
  for (let i = 0; i < 3; i++) {
    await evalJs("(function(){var g=document.querySelector(\".tk-trip-group\"); if(g && g.getAttribute(\"aria-expanded\") !== \"true\") g.click(); return 1;})()");
    await sleep(700);
    await evalJs("(function(){var b=[...document.querySelectorAll(\"button[title=Edit]\")]; if(b[0]) b[0].click(); return 1;})()");
    await sleep(1100);
    await evalJs("(function(){var f=document.querySelector(\"form\"); if(f) f.requestSubmit(); return 1;})()");
    await sleep(600);
  }
  const stacked = await countToasts();
  check("repeated actions raise toasts", stacked >= 1, "could not raise any (count=" + stacked + ")");

  await sleep(5200);
  const cleared = await countToasts();
  check("and all of them clear on their own", stacked >= 1 && cleared === 0, "still showing " + cleared);

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  ws.close(); chrome.kill();
  await sleep(250);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error("ERR", e.message); process.exitCode = 2; });
