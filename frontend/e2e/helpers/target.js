/**
 * Is the browser suite pointed at Trackify, and only at Trackify?
 *
 * The suite signs in with a seeded staff account and drives a real browser. On
 * a developer machine several projects share the same few ports (5173 for Vite
 * is the usual collision), so a URL that "answers" proves nothing: the first
 * run of the search specs found another project's sign-in page on 5173 and
 * failed every test with a baffling selector error. Worse would be the case
 * where it did not fail, and a Trackify account's credentials were typed into
 * some other application.
 *
 * So before any test runs this checks, by asking rather than assuming, that
 *   • both URLs are on this machine (override: TRACKIFY_E2E_ALLOW_REMOTE=yes),
 *   • the web page is Trackify's, by its <title>, and
 *   • the API is Trackify's, by the `service` its health endpoint reports —
 *     including the API the web page itself reaches, since a dev server proxies
 *     /api onward to whatever is on its configured port.
 *
 * Pure apart from the injected `fetchImpl`, so it is unit tested.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
export const EXPECTED_SERVICE = "trackify-api";
const TITLE = /<title[^>]*>([^<]*)<\/title>/i;

const clean = (v) => String(v || "").trim().slice(0, 80);

async function ask(fetchImpl, url, parse) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    return { res, value: await parse(res) };
  } catch (error) {
    return { error: error?.cause?.code || error?.name || "request failed" };
  }
}

export async function checkTarget({ webUrl, apiUrl, env = {}, fetchImpl = fetch }) {
  const problems = [];
  const remoteOk = env.TRACKIFY_E2E_ALLOW_REMOTE === "yes";

  for (const [label, raw] of [["TRACKIFY_WEB_URL", webUrl], ["TRACKIFY_API_URL", apiUrl]]) {
    let host;
    try { host = new URL(raw).hostname; } catch { problems.push(`${label} is not a URL: ${clean(raw)}`); continue; }
    if (!LOOPBACK.has(host) && !remoteOk) {
      problems.push(`${label} points at ${host}, not this machine. Set TRACKIFY_E2E_ALLOW_REMOTE=yes only if you mean to test a remote Trackify.`);
    }
  }
  if (problems.length) return problems;

  const page = await ask(fetchImpl, webUrl, (r) => r.text());
  if (page.error) {
    problems.push(`Nothing answered at ${webUrl} (${page.error}). Start Trackify's web server or set TRACKIFY_WEB_URL.`);
  } else {
    const title = TITLE.exec(page.value)?.[1];
    if (!/trackify/i.test(title || "")) {
      problems.push(`${webUrl} is not Trackify (its page title is "${clean(title) || "missing"}"). Another project may be using that port.`);
    }
  }

  // [base, label, optional]. The web server's own route to the API exists for a
  // dev proxy or a same-origin deployment; a split deployment (frontend/server.js
  // serving static files, API on its own host) has none, and answers /api/health
  // with the app's HTML. That is not a problem — only a *different* service
  // answering there is.
  const probes = [[apiUrl, "TRACKIFY_API_URL", false]];
  if (!page.error) probes.push([webUrl, "the API behind TRACKIFY_WEB_URL", true]);

  for (const [base, label, optional] of probes) {
    const api = await ask(fetchImpl, `${base.replace(/\/$/, "")}/api/health`, (r) => r.json());
    if (api.error) {
      if (!optional) problems.push(`No Trackify API answered for ${label} (${api.error}).`);
    } else if (api.value?.service !== EXPECTED_SERVICE) {
      problems.push(`${label} is not Trackify's API (its health check says service "${clean(api.value?.service) || "unknown"}").`);
    }
  }
  return problems;
}
