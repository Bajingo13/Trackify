import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (path.basename(file) === "index.html") {
    res.setHeader("Cache-Control", "no-cache");
  } else {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;

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
});
