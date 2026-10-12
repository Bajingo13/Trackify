import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { API_URL, installStaffSession, loadSeededStaffSession } from "./helpers/staffSession.js";

/**
 * Browser checks for the Trips list that need a REAL dataset larger than one page.
 *
 *   node backend/scripts/qa-trips.mjs seed 135 --branch <id>
 *   node backend/scripts/qa-trips-verify.mjs --branch <id>       (adds the harder QA-X rows)
 *   $env:TRACKIFY_TEST_BRANCH_ID = "<id>"
 *
 * Every case skips itself when the branch has 130 trips or fewer, so the suite stays
 * green on a small database. The dashboard case compares against numbers counted by
 * SQL, which the runner passes in through EXPECT_* variables (see the case).
 */

const MIN = 130;

async function apiTotal(request) {
  const s = await loadSeededStaffSession();
  const res = await request.get(`${API_URL}/api/v1/operations/trips?limit=1`, {
    headers: { Authorization: `Bearer ${s.user.token}`, "X-Company-Id": String(s.companyId), "X-Branch-Id": String(s.branchId) },
  });
  return (await res.json()).pagination.total;
}

/** A minimal RFC 4180 reader: quoted fields, doubled quotes, commas and newlines inside quotes. */
function parseCsv(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i += 1; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

test.beforeEach(async ({ context, request }) => {
  await installStaffSession(context);
  const total = await apiTotal(request);
  test.skip(total <= MIN, `needs more than ${MIN} trips in the branch (has ${total}); seed with backend/scripts/qa-trips.mjs`);
});

test("typing on cancels the earlier search, and only the latest answer is ever shown", async ({ page }) => {
  const aborted = [];
  page.on("requestfailed", (r) => { if (r.url().includes("/operations/trips?") && r.failure()?.errorText === "net::ERR_ABORTED") aborted.push(new URL(r.url()).searchParams.get("search")); });

  // Slow down ONLY the broad search, so it is still in flight when the narrower one is sent.
  await page.route("**/api/v1/operations/trips?*", async (route) => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get("search") === "QA-00") await new Promise((r) => setTimeout(r, 2500));
    try { await route.continue(); } catch { /* the page cancelled it: exactly what is under test */ }
  });

  await page.goto("/operations/trips");
  await page.waitForLoadState("networkidle");
  const box = page.getByPlaceholder("Search trips…");
  await box.fill("QA-00");                 // request 1: slow
  await page.waitForTimeout(500);          // past the 300 ms pause, so it has been sent
  await box.fill("QA-0042");               // request 2: fast, replaces it
  await expect(page.getByText("1 trip", { exact: true })).toBeVisible();

  await page.waitForTimeout(3000);         // long enough for request 1 to have "answered" if it were still alive
  await expect(page.getByText("1 trip", { exact: true })).toBeVisible();     // the slow, broader answer never replaced it
  await expect(page.getByText("QA-0042").first()).toBeVisible();
  expect(aborted, "the slow request was cancelled by the browser, not left running").toContain("QA-00");
});

test("clicking through pages quickly shows the page you ended on, and cancels the ones in between", async ({ page }) => {
  const aborted = [];
  page.on("requestfailed", (r) => { if (r.failure()?.errorText === "net::ERR_ABORTED" && r.url().includes("/operations/trips?")) aborted.push(new URL(r.url()).searchParams.get("page")); });
  await page.route("**/api/v1/operations/trips?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("page") === "2") await new Promise((r) => setTimeout(r, 2500));
    try { await route.continue(); } catch { /* cancelled */ }
  });

  await page.goto("/operations/trips");
  await page.getByRole("button", { name: "Table view" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "2", exact: true }).click();   // slow
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "1", exact: true }).click();   // back to the fast one
  await expect(page.getByText(/Showing 1 to 20 of/)).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(page.getByText(/Showing 1 to 20 of/)).toBeVisible();     // page 2's late answer did not take over
  expect(aborted).toContain("2");
});

test("the dashboard cards equal the numbers counted in the database", async ({ page }) => {
  const expected = { "Trips Today": process.env.EXPECT_TRIPS_TODAY, "In Transit": process.env.EXPECT_IN_TRANSIT, "Awaiting Approval": process.env.EXPECT_AWAITING };
  test.skip(Object.values(expected).some((v) => v === undefined), "set EXPECT_TRIPS_TODAY, EXPECT_IN_TRANSIT and EXPECT_AWAITING (counted by SQL) to run this case");
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  for (const [label, want] of Object.entries(expected)) {
    const m = new RegExp(`(\\d+)\\s+${label}`, "i").exec(text);
    expect(m, `${label} card not found`).not.toBeNull();
    expect(m[1], label).toBe(String(want));
  }
});

test("the CSV is complete and survives quotes, commas, newlines and unicode", async ({ page, request }) => {
  const total = await apiTotal(request);
  await page.goto("/operations/trips");
  await page.waitForLoadState("networkidle");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
  const raw = await readFile(await download.path(), "utf8");
  expect(raw.charCodeAt(0), "starts with a byte-order mark so Excel reads UTF-8").toBe(0xfeff);

  const rows = parseCsv(raw.slice(1)).filter((r) => r.length > 1 || r[0] !== "");
  const [header, ...data] = rows;
  expect(header.slice(0, 4)).toEqual(["Trip", "Customer", "Origin", "Destination"]);
  expect(data.length, "one line per trip, all of them").toBe(Math.min(total, 5000));
  expect(data.every((r) => r.length === header.length), "no row was split or merged by a stray quote/comma/newline").toBe(true);
  expect(new Set(data.map((r) => r[0])).size, "no trip twice").toBe(data.length);

  const find = (no) => data.find((r) => r[0] === no);
  const t1 = find("QA-XT1"), t2 = find("QA-XT2"), t3 = find("QA-XT3");
  test.skip(!t1, "run backend/scripts/qa-trips-verify.mjs first to add the QA-X text fixtures");
  expect(t1[2]).toBe(`O'Brien, "Quoted" & <b>bold</b>`);
  expect(t2[2]).toBe("Café – Dávao 🚚");
  expect(t2[3]).toBe("Line one\nLine two");
  expect(t3[2]).toBe("100% real_deal");
  expect(t3[3]).toBe("back\\slash");
});

test("the first screen of trips and counts loads quickly with this much data", async ({ page }) => {
  const timings = {};
  page.on("response", async (r) => {
    const u = new URL(r.url());
    if (u.pathname.endsWith("/operations/trips") || u.pathname.endsWith("/operations/trips/summary")) {
      const t = r.request().timing();
      timings[u.pathname.split("/").pop()] = t.responseEnd; // ms from request start to the last byte
    }
  });
  await page.goto("/operations/trips");
  await page.waitForLoadState("networkidle");
  expect(timings.trips, "list request").toBeLessThan(1000);
  expect(timings.summary, "summary request").toBeLessThan(1000);
});
