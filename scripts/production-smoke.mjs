const frontendUrl = process.env.TRACKIFY_FRONTEND_URL;
const backendUrl = process.env.TRACKIFY_BACKEND_URL;

if (!frontendUrl || !backendUrl) {
  console.error("Set TRACKIFY_FRONTEND_URL and TRACKIFY_BACKEND_URL before running the production smoke check.");
  process.exit(2);
}

async function check(name, url, validate) {
  const started = Date.now();
  const response = await fetch(url, {
    headers: { "user-agent": "trackify-production-smoke/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}: ${body.slice(0, 200)}`);
  if (validate && !validate(body)) throw new Error(`${name} returned an unexpected response.`);
  console.log(`${name}: HTTP ${response.status} (${Date.now() - started} ms)`);
}

try {
  await check("frontend", new URL("/health", frontendUrl), (body) => body.includes("trackify-frontend"));
  await check("backend", new URL("/api/health", backendUrl), (body) => {
    const health = JSON.parse(body);
    return health.status === "ok" && health.database === "connected";
  });
  console.log("Production smoke check passed.");
} catch (error) {
  console.error(`Production smoke check failed: ${error.message}`);
  process.exit(1);
}
