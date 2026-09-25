import { describe, test, expect, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  buildPolicy, securityHeaders, templateOrigin, originOf,
  summarizeReport, createReportLogger, DEFAULT_TILE_URL,
} from "./securityHeaders"

/**
 * The console's security headers.
 *
 * A Content-Security-Policy fails silently: allow one origin too few and the
 * map goes blank, or every API call is refused, with nothing on screen to say
 * why. So these pin the origins against the ones the build actually uses, not
 * against a list somebody remembered.
 */

const PROD = {
  VITE_API_URL: "https://trackify-backend-production-a447.up.railway.app",
}

describe("the policy", () => {
  test("is Report-Only unless explicitly enforced — it cannot break a deployment", () => {
    expect(buildPolicy(PROD).header).toBe("Content-Security-Policy-Report-Only")
    expect(buildPolicy({ ...PROD, CSP_MODE: "enforce" }).header).toBe("Content-Security-Policy")
  })

  test("allows the API over HTTPS and the realtime channel over WSS", () => {
    // The realtime hub is a WebSocket on the API host. Leave wss out and live
    // tracking stops updating with no visible error.
    const { directives } = buildPolicy(PROD)
    expect(directives["connect-src"]).toContain("https://trackify-backend-production-a447.up.railway.app")
    expect(directives["connect-src"]).toContain("wss://trackify-backend-production-a447.up.railway.app")
  })

  test("a local API gets ws, not wss", () => {
    const { directives } = buildPolicy({ VITE_API_URL: "http://localhost:5000" })
    expect(directives["connect-src"]).toContain("http://localhost:5000")
    expect(directives["connect-src"]).toContain("ws://localhost:5000")
  })

  test("allows the map's tiles, and the worker it renders in", () => {
    // MapLibre fetches raster tiles with fetch() — connect-src, not only
    // img-src — and runs its renderer in a worker built from a blob: URL.
    const { directives } = buildPolicy(PROD)
    expect(directives["connect-src"]).toContain("https://tile.openstreetmap.org")
    expect(directives["img-src"]).toContain("https://tile.openstreetmap.org")
    expect(directives["worker-src"]).toEqual(["'self'", "blob:"])
  })

  test("allows data: and blob: images — receipts and upload previews use both", () => {
    const { directives } = buildPolicy(PROD)
    expect(directives["img-src"]).toEqual(expect.arrayContaining(["data:", "blob:"]))
  })

  test("never allows inline or eval'd script", () => {
    const { value } = buildPolicy({ ...PROD, CSP_MODE: "enforce" })
    const script = value.split("; ").find((d) => d.startsWith("script-src"))
    expect(script).toBe("script-src 'self'")
    expect(value).not.toMatch(/unsafe-eval/)
  })

  test("blocks plugins and base-tag hijacking", () => {
    const { directives } = buildPolicy(PROD)
    expect(directives["object-src"]).toEqual(["'none'"])
    expect(directives["base-uri"]).toEqual(["'self'"])
  })

  test("frame-ancestors only appears once enforced — browsers ignore it in Report-Only", () => {
    expect(buildPolicy(PROD).directives["frame-ancestors"]).toBeUndefined()
    expect(buildPolicy({ ...PROD, CSP_MODE: "enforce" }).directives["frame-ancestors"]).toEqual(["'none'"])
  })

  test("a custom tile provider and extra origins are honoured", () => {
    const { directives } = buildPolicy({
      ...PROD,
      VITE_MAP_TILE_URL: "https://{s}.tiles.example.org/{z}/{x}/{y}.png",
      CSP_CONNECT_SRC: "https://api.maptiler.com, wss://feed.example.org",
    })
    expect(directives["connect-src"]).toContain("https://*.tiles.example.org")
    expect(directives["connect-src"]).toContain("https://api.maptiler.com")
    expect(directives["connect-src"]).toContain("wss://feed.example.org")
  })

  test("junk in the extra-origins variable cannot inject a directive", () => {
    const { value } = buildPolicy({ ...PROD, CSP_CONNECT_SRC: "https://ok.example; script-src *" })
    expect(value).not.toMatch(/script-src \*/)
  })

  test("says when the API origin is unknown, so an enforced policy is not deployed blind", () => {
    expect(buildPolicy({}).apiKnown).toBe(false)
    expect(buildPolicy(PROD).apiKnown).toBe(true)
  })
})

describe("the tile default", () => {
  test("is the same one the map falls back to", () => {
    /*
     * If the map's default changed and this did not, an unset variable would
     * produce one origin in the browser and another in the policy, and the map
     * would go blank the day the policy is enforced.
     */
    const mapView = fs.readFileSync(
      path.resolve(__dirname, "../components/map/MapView.jsx"), "utf8"
    )
    expect(mapView).toContain(DEFAULT_TILE_URL)
  })
})

describe("origins from templates", () => {
  test.each([
    ["https://tile.openstreetmap.org/{z}/{x}/{y}.png", "https://tile.openstreetmap.org"],
    ["https://{s}.tile.example.org/{z}/{x}/{y}.png", "https://*.tile.example.org"],
    ["http://localhost:8080/{z}/{x}/{y}.png", "http://localhost:8080"],
  ])("%s -> %s", (tpl, expected) => {
    expect(templateOrigin(tpl)).toBe(expected)
  })

  test("a placeholder anywhere but the leftmost label is refused", () => {
    expect(templateOrigin("https://tiles.{s}.example.org/{z}.png")).toBeNull()
  })

  test("non-http schemes are not origins", () => {
    expect(originOf("javascript:alert(1)")).toBeNull()
    expect(originOf("not a url")).toBeNull()
  })
})

describe("the headers", () => {
  test("framing is refused and HTTPS is pinned, in both modes", () => {
    for (const env of [PROD, { ...PROD, CSP_MODE: "enforce" }]) {
      const h = securityHeaders(buildPolicy(env))
      expect(h["X-Frame-Options"]).toBe("DENY")
      expect(h["Strict-Transport-Security"]).toMatch(/max-age=31536000/)
      expect(h["X-Content-Type-Options"]).toBe("nosniff")
    }
  })
})

describe("violation reports", () => {
  test("a report becomes one readable line", () => {
    const line = summarizeReport({
      "csp-report": {
        "document-uri": "https://console.example/operations/trips",
        "effective-directive": "connect-src",
        "blocked-uri": "https://evil.example/collect",
      },
    })
    expect(line).toBe("[csp] connect-src would block https://evil.example/collect on https://console.example/operations/trips")
  })

  test("query strings are dropped — a reset link or a search term does not belong in a log", () => {
    const line = summarizeReport({
      "csp-report": {
        "document-uri": "https://console.example/reset-password?token=SECRET123",
        "violated-directive": "img-src",
        "blocked-uri": "https://x.example/p.png?user=ana",
      },
    })
    expect(line).not.toMatch(/SECRET123|user=ana/)
  })

  test("the newer Reporting API shape is understood too", () => {
    const line = summarizeReport({
      type: "csp-violation",
      body: { documentURL: "https://c.example/", effectiveDirective: "worker-src", blockedURL: "blob" },
    })
    expect(line).toMatch(/worker-src would block blob/)
  })

  test("the log cannot be flooded through the public endpoint", () => {
    let t = 0
    const log = vi.fn()
    const report = createReportLogger({ limitPerMinute: 3, log, now: () => t })
    for (let i = 0; i < 10; i += 1) report({ "csp-report": { "violated-directive": "img-src" } })
    expect(log).toHaveBeenCalledTimes(3)

    t = 61_000
    report({ "csp-report": { "violated-directive": "img-src" } })
    expect(log).toHaveBeenCalledWith("[csp] 7 further report(s) suppressed in the last minute")
  })
})
