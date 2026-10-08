import { describe, expect, it } from "vitest";
import { checkTarget } from "../../e2e/helpers/target.js";

/** A fake network: exact url -> body (string for HTML, object for JSON). An unlisted url is a refused connection. */
function network(routes) {
  return async (url) => {
    const body = routes[url] ?? routes[url.replace(/\/$/, "")];
    if (body === undefined) throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    return { text: async () => body, json: async () => (typeof body === "string" ? JSON.parse(body) : body) };
  };
}

const WEB = "http://localhost:5180";
const API = "http://localhost:5000";
const trackify = {
  [WEB + "/api/health"]: { service: "trackify-api" },
  [WEB]: "<html><head><title>AstreaBlue Trackify</title></head></html>",
  [API + "/api/health"]: { service: "trackify-api" },
};
const run = (routes, extra = {}) => checkTarget({ webUrl: WEB, apiUrl: API, fetchImpl: network(routes), ...extra });

describe("the browser suite's target check", () => {
  it("accepts Trackify's web page and API on this machine", async () => {
    expect(await run(trackify)).toEqual([]);
  });

  it("refuses another project's page on the same port, and says what it found", async () => {
    const problems = await run({ ...trackify, [WEB]: "<title>Bloom &amp; Borrow</title>" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/is not Trackify/);
    expect(problems[0]).toMatch(/Bloom/);
  });

  it("refuses an API that is not Trackify's", async () => {
    const problems = await run({ ...trackify, [API + "/api/health"]: { service: "something-else" } });
    expect(problems.join()).toMatch(/TRACKIFY_API_URL is not Trackify's API/);
  });

  it("refuses when the web server proxies to some other backend", async () => {
    const problems = await run({ ...trackify, [WEB + "/api/health"]: { service: "bloom-api" } });
    expect(problems.join()).toMatch(/API behind TRACKIFY_WEB_URL is not Trackify's/);
  });

  it("accepts a split deployment, where the web server has no /api of its own", async () => {
    // frontend/server.js serves static files and answers /api/health with HTML.
    const { [WEB + "/api/health"]: _unused, ...split } = trackify;
    const fetchImpl = async (url) => {
      if (url === WEB + "/api/health") return { text: async () => "<html></html>", json: async () => { throw new SyntaxError("Unexpected token <"); } };
      return network(split)(url);
    };
    expect(await checkTarget({ webUrl: WEB, apiUrl: API, fetchImpl })).toEqual([]);
  });

  it("explains a port with nothing on it instead of throwing", async () => {
    const problems = await run({ [API + "/api/health"]: { service: "trackify-api" } });
    expect(problems.join()).toMatch(/Nothing answered at http:\/\/localhost:5180/);
  });

  it("refuses a page with no title", async () => {
    const problems = await run({ ...trackify, [WEB]: "<html></html>" });
    expect(problems.join()).toMatch(/title is "missing"/);
  });

  it("refuses a remote host unless that is explicitly allowed, before contacting it", async () => {
    let contacted = false;
    const fetchImpl = async () => { contacted = true; throw new Error("must not be called"); };
    const problems = await checkTarget({ webUrl: "https://app.example.com", apiUrl: API, fetchImpl });
    expect(problems.join()).toMatch(/not this machine/);
    expect(contacted).toBe(false);
  });

  it("allows a remote host when told to", async () => {
    const remote = "https://staging.example.com";
    const problems = await checkTarget({
      webUrl: remote, apiUrl: remote, env: { TRACKIFY_E2E_ALLOW_REMOTE: "yes" },
      fetchImpl: network({ [remote + "/api/health"]: { service: "trackify-api" }, [remote]: "<title>AstreaBlue Trackify</title>" }),
    });
    expect(problems).toEqual([]);
  });

  it("reports a malformed URL", async () => {
    const problems = await checkTarget({ webUrl: "not a url", apiUrl: API, fetchImpl: async () => { throw new Error("no"); } });
    expect(problems.join()).toMatch(/TRACKIFY_WEB_URL is not a URL/);
  });
});
