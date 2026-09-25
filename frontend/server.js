import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolicy, securityHeaders, createReportLogger } from "./src/server/securityHeaders.js";

/* Computed once: the policy depends only on the environment the service was
 * started with. Logged at startup so the deployed policy can be read in the
 * service's own log rather than inferred. */
const policy = buildPolicy(process.env);
const HEADERS = securityHeaders(policy);
const logReport = createReportLogger();
const REPORT_LIMIT_BYTES = 16 * 1024;

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceDist = path.resolve(here, "dist");
const webRoot = existsSync(serviceDist)
  ? serviceDist
  : path.resolve(here, "..", "dist");
const port = Number(process.env.PORT) || 3000;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

function sendFile(res, file) {
  res.statusCode = 200;
  res.setHeader("Content-Type", contentTypes[path.extname(file)] || "application/octet-stream");
  if (path.basename(file) === "index.html") {
    res.setHeader("Cache-Control", "no-cache");
  } else {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  // Every response, including errors and the health check.
  for (const [name, value] of Object.entries(HEADERS)) res.setHeader(name, value);

  const pathname = new URL(req.url || "/", "http://localhost").pathname;

  /*
   * Where browsers send Content-Security-Policy violation reports. Public by
   * necessity, so the body is capped and the logging is rate-limited; nothing
   * is stored.
   */
  if (pathname === "/csp-report") {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      return res.end();
    }
    let size = 0;
    const chunks = [];
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > REPORT_LIMIT_BYTES) {
        tooLarge = true;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) return;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        for (const entry of Array.isArray(parsed) ? parsed : [parsed]) logReport(entry);
      } catch {
        /* not a report; say nothing, log nothing */
      }
      res.writeHead(204);
      res.end();
    });
    req.on("close", () => {
      if (tooLarge && !res.headersSent) {
        res.writeHead(413);
        res.end();
      }
    });
    return undefined;
  }

  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ status: "ok", service: "trackify-frontend" }));
  }

  let relative;
  try {
    relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }

  const requested = path.resolve(webRoot, relative);
  const insideRoot = requested === webRoot || requested.startsWith(`${webRoot}${path.sep}`);
  if (insideRoot && existsSync(requested) && statSync(requested).isFile()) {
    return sendFile(res, requested);
  }

  // React Router owns browser routes; unknown asset requests remain true 404s.
  if (path.extname(relative)) {
    res.writeHead(404);
    return res.end("Not found");
  }
  return sendFile(res, path.join(webRoot, "index.html"));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Trackify frontend running on port ${port}`);
  console.log(
    `Content-Security-Policy: ${policy.enforce ? "ENFORCED" : "report-only (set CSP_MODE=enforce once reports are clean)"}`
  );
  if (!policy.apiKnown) {
    // Without it the API origin is missing from connect-src, and an enforced
    // policy would block every call the console makes.
    console.log("  warning: VITE_API_URL is not set at runtime — the API origin is not in connect-src");
  }
  console.log(`  ${policy.value}`);
});
