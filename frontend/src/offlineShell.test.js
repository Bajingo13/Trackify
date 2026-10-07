import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { registerStaffWorker, shouldRegisterStaffWorker } from "./offlineShell";

const ok = { prod: true, nav: { serviceWorker: {} }, secure: true, pathname: "/dashboard" };

describe("shouldRegisterStaffWorker", () => {
  it("registers in a secure production page", () => {
    expect(shouldRegisterStaffWorker(ok)).toBe(true);
  });
  it.each([
    ["development", { prod: false }],
    ["an insecure origin", { secure: false }],
    ["a browser without service workers", { nav: {} }],
    ["no navigator", { nav: undefined }],
    ["the Driver App", { pathname: "/driver" }],
    ["a Driver App sub-path", { pathname: "/driver/trips" }],
  ])("does not register for %s", (_, override) => {
    expect(shouldRegisterStaffWorker({ ...ok, ...override })).toBe(false);
  });
  it("does not mistake a path that only starts with 'driver'", () => {
    expect(shouldRegisterStaffWorker({ ...ok, pathname: "/drivers-report" })).toBe(true);
  });
});

describe("registerStaffWorker", () => {
  it("registers /staff-sw.js at scope / and swallows a refusal", async () => {
    const register = vi.fn(() => Promise.reject(new Error("blocked")));
    const did = registerStaffWorker({ ...ok, nav: { serviceWorker: { register } } });
    expect(did).toBe(true);
    expect(register).toHaveBeenCalledWith("/staff-sw.js", { scope: "/" });
    await Promise.resolve();
  });
  it("does nothing when it should not register", () => {
    const register = vi.fn();
    expect(registerStaffWorker({ ...ok, prod: false, nav: { serviceWorker: { register } } })).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });
});

/* The worker itself, run in a sandbox with a fake cache, to pin down what it
 * will and will not serve. */
function loadWorker() {
  const handlers = {};
  const store = new Map();
  const cache = {
    put: vi.fn(async (req, res) => { store.set(typeof req === "string" ? req : req.url, res); }),
    add: vi.fn(async () => {}),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
  };
  const caches = {
    open: vi.fn(async () => cache),
    match: vi.fn(async (req) => store.get(typeof req === "string" ? req : req.url)),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
  };
  const fetchMock = vi.fn();
  const self = {
    location: { origin: "https://console.test" },
    addEventListener: (name, fn) => { handlers[name] = fn; },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const source = readFileSync(path.resolve(import.meta.dirname, "../public/staff-sw.js"), "utf8");
  vm.runInNewContext(source, { self, caches, fetch: fetchMock, URL, Response, Promise, Set, Map, console });
  return { handlers, store, cache, caches, fetchMock };
}

function dispatchFetch(handlers, url, { method = "GET", mode = "cors" } = {}) {
  let responded;
  handlers.fetch({
    request: { url, method, mode },
    respondWith: (p) => { responded = p; },
  });
  return responded;
}

const html = () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });

describe("staff-sw.js", () => {
  it("leaves the API, other origins, non-GETs and the Driver App alone", () => {
    const { handlers } = loadWorker();
    expect(dispatchFetch(handlers, "https://console.test/api/v1/trips", { mode: "navigate" })).toBeUndefined();
    expect(dispatchFetch(handlers, "https://console.test/api/v1/trips")).toBeUndefined();
    expect(dispatchFetch(handlers, "https://api.test/assets/a.js")).toBeUndefined();
    expect(dispatchFetch(handlers, "https://console.test/dashboard", { method: "POST", mode: "navigate" })).toBeUndefined();
    expect(dispatchFetch(handlers, "https://console.test/driver", { mode: "navigate" })).toBeUndefined();
    expect(dispatchFetch(handlers, "https://console.test/driver/trips", { mode: "navigate" })).toBeUndefined();
    expect(dispatchFetch(handlers, "https://console.test/privacy-policy.html", { mode: "navigate" })).toBeUndefined();
    expect(dispatchFetch(handlers, "https://console.test/health", { mode: "navigate" })).toBeUndefined();
  });

  it("serves the network page when online and keeps a copy of the shell", async () => {
    const { handlers, fetchMock, store } = loadWorker();
    fetchMock.mockResolvedValue(html());
    const res = await dispatchFetch(handlers, "https://console.test/operations/dispatch", { mode: "navigate" });
    expect(await res.text()).toBe("<html></html>");
    await Promise.resolve();
    expect(store.has("/index.html")).toBe(true);
  });

  it("falls back to the cached shell for any app route when offline", async () => {
    const { handlers, fetchMock, store } = loadWorker();
    store.set("/index.html", html());
    fetchMock.mockRejectedValue(new TypeError("offline"));
    const res = await dispatchFetch(handlers, "https://console.test/finance/invoices?x=1", { mode: "navigate" });
    expect(res.status).toBe(200);
  });

  it("fails like the browser would when offline with nothing cached", async () => {
    const { handlers, fetchMock } = loadWorker();
    fetchMock.mockRejectedValue(new TypeError("offline"));
    const res = await dispatchFetch(handlers, "https://console.test/dashboard", { mode: "navigate" });
    expect(res.type).toBe("error");
  });

  it("does not cache an error page as the shell", async () => {
    const { handlers, fetchMock, store } = loadWorker();
    fetchMock.mockResolvedValue(new Response("nope", { status: 502, headers: { "content-type": "text/html" } }));
    await dispatchFetch(handlers, "https://console.test/dashboard", { mode: "navigate" });
    await Promise.resolve();
    expect(store.has("/index.html")).toBe(false);
  });

  it("serves hashed assets from the cache without touching the network", async () => {
    const { handlers, fetchMock, store } = loadWorker();
    store.set("https://console.test/assets/app-abc.js", new Response("js"));
    const res = await dispatchFetch(handlers, "https://console.test/assets/app-abc.js");
    expect(await res.text()).toBe("js");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and stores an asset it has not seen", async () => {
    const { handlers, fetchMock, store } = loadWorker();
    fetchMock.mockResolvedValue(new Response("js", { status: 200 }));
    await dispatchFetch(handlers, "https://console.test/assets/new-1.js");
    await new Promise((r) => setTimeout(r, 0));
    expect(store.has("https://console.test/assets/new-1.js")).toBe(true);
  });

  it("does not intercept anything else on its own origin", () => {
    const { handlers } = loadWorker();
    expect(dispatchFetch(handlers, "https://console.test/favicon.svg")).toBeUndefined();
  });
});
