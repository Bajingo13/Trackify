import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { API_URL, installStaffSession, loadSeededStaffSession } from "./helpers/staffSession.js";

/**
 * The Trips list is filtered, counted and paged by the server.
 *
 * It used to fetch "everything" (asking for 1000, receiving 100) and filter in
 * the browser, so past 100 trips the list, the totals and the CSV were quietly
 * incomplete. These check the behaviour against the real API and database: the
 * numbers on screen come from the server's total, the pager walks real pages,
 * a filter returns to page 1, and the export contains every match, not just the
 * page on screen.
 *
 * They adapt to the data in the database instead of assuming it: a case that
 * needs more than one page skips itself when there are fewer trips than that.
 */

const PAGE = 20;

async function api(request, path) {
  const s = await loadSeededStaffSession();
  const res = await request.get(`${API_URL}/api/v1${path}`, {
    headers: {
      Authorization: `Bearer ${s.user.token}`,
      "X-Company-Id": String(s.companyId),
      "X-Branch-Id": String(s.branchId),
    },
  });
  expect(res.status()).toBe(200);
  return res.json();
}

test.beforeEach(async ({ context }) => installStaffSession(context));

test("the count on screen is the server's total, not the length of what was downloaded", async ({ page, request }) => {
  const { pagination } = await api(request, `/operations/trips?limit=${PAGE}`);
  await page.goto("/operations/trips");
  await page.waitForLoadState("networkidle");
  const label = pagination.total === 1 ? "1 trip" : `${pagination.total.toLocaleString()} trips`;
  await expect(page.getByText(label, { exact: true })).toBeVisible();
});

test("the stat cards come from the summary endpoint and agree with it", async ({ page, request }) => {
  const { data } = await api(request, "/operations/trips/summary");
  await page.goto("/operations/trips");
  await page.waitForLoadState("networkidle");
  const total = page.locator("text=Total").first().locator("xpath=ancestor::*[self::button or self::div][1]");
  // the page formats thousands ("5,047"), so compare the formatted number
  await expect(total).toContainText(data.total.toLocaleString("en-US"));
});

test("pages through real pages: shows the first slice, then the next, then comes back", async ({ page, request }) => {
  const first = await api(request, `/operations/trips?limit=${PAGE}&page=1`);
  test.skip(first.pagination.total <= PAGE, `needs more than ${PAGE} trips to have a second page`);
  const second = await api(request, `/operations/trips?limit=${PAGE}&page=2`);

  await page.goto("/operations/trips");
  await page.getByRole("button", { name: "Table view" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(`Showing 1 to ${PAGE} of ${first.pagination.total} entries`)).toBeVisible();
  await expect(page.getByText(first.data[0].ticket_no).first()).toBeVisible();
  await expect(page.getByText(second.data[0].ticket_no)).toHaveCount(0);

  await page.getByRole("button", { name: "2", exact: true }).click();
  const end = Math.min(2 * PAGE, first.pagination.total);
  await expect(page.getByText(`Showing ${PAGE + 1} to ${end} of ${first.pagination.total} entries`)).toBeVisible();
  await expect(page.getByText(second.data[0].ticket_no).first()).toBeVisible();
  await expect(page.getByText(first.data[0].ticket_no)).toHaveCount(0);

  await page.getByRole("button", { name: "1", exact: true }).click();
  await expect(page.getByText(first.data[0].ticket_no).first()).toBeVisible();
});

test("changing a filter returns to the first page and the total follows the filter", async ({ page, request }) => {
  const all = await api(request, `/operations/trips?limit=${PAGE}`);
  test.skip(all.pagination.total <= PAGE, "needs a second page to leave");
  // Only some statuses have a tab on the page (the others — for_validation, returned,
  // cancelled — are reachable by the API but not by a button), so pick one that does.
  const TABS = { draft: "Draft", for_approval: "For Approval", approved: "Approved", assigned: "Assigned", in_transit: "In Transit", delivered: "Delivered", operationally_closed: "Closed" };
  const status = all.data.map((t) => t.status).find((st) => TABS[st]) || "draft";
  const filtered = await api(request, `/operations/trips?limit=${PAGE}&status=${status}`);

  await page.goto("/operations/trips");
  await page.getByRole("button", { name: "Table view" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "2", exact: true }).click();
  await expect(page.getByText(/Showing 21 to/)).toBeVisible();

  const requested = page.waitForRequest((r) => r.url().includes("/operations/trips?") && r.url().includes(`status=${status}`));
  // choose the status through the page's own control
  const label = TABS[status];
  await page.getByRole("radio", { name: label, exact: true }).or(page.getByRole("button", { name: label, exact: true })).first().click();
  const req = await requested;
  expect(new URL(req.url()).searchParams.get("page")).toBe("1");
  const n = filtered.pagination.total;
  await expect(page.getByText(n === 1 ? "1 trip" : `${n.toLocaleString()} trips`, { exact: true })).toBeVisible();
});

test("a search is answered by the server, not by filtering the page", async ({ page, request }) => {
  const all = await api(request, `/operations/trips?limit=${PAGE}`);
  test.skip(all.pagination.total === 0, "no trips to search");
  const term = all.data[0].ticket_no;
  const expected = await api(request, `/operations/trips?limit=${PAGE}&search=${encodeURIComponent(term)}`);

  await page.goto("/operations/trips");
  await page.waitForLoadState("networkidle");
  const requested = page.waitForRequest((r) => r.url().includes("/operations/trips?") && r.url().includes("search="));
  await page.getByPlaceholder("Search trips…").fill(term);
  const req = await requested;
  expect(new URL(req.url()).searchParams.get("search")).toBe(term);
  const n = expected.pagination.total;
  await expect(page.getByText(n === 1 ? "1 trip" : `${n.toLocaleString()} trips`, { exact: true })).toBeVisible();
});

test("a search that matches nothing says so, instead of leaving the old list", async ({ page }) => {
  await page.goto("/operations/trips");
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder("Search trips…").fill("zzz-no-such-trip-zzz");
  await expect(page.getByText("No trips match")).toBeVisible();
  await expect(page.getByText("0 trips", { exact: true })).toBeVisible();
});

test("Export CSV contains every matching trip, not just the page on screen", async ({ page, request }) => {
  const all = await api(request, `/operations/trips?limit=${PAGE}`);
  test.skip(all.pagination.total === 0, "no trips to export");

  await page.goto("/operations/trips");
  await page.waitForLoadState("networkidle");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
  const text = await readFile(await download.path(), "utf8");
  const lines = text.trim().split("\r\n");
  expect(lines.length - 1).toBe(Math.min(all.pagination.total, 5000)); // header + one line per trip
  expect(lines[0]).toContain("Trip,Customer,Origin,Destination");
});

test("the server refuses a malformed filter instead of answering 'no trips'", async ({ request }) => {
  const s = await loadSeededStaffSession();
  const headers = { Authorization: `Bearer ${s.user.token}`, "X-Company-Id": String(s.companyId), "X-Branch-Id": String(s.branchId) };
  for (const q of ["status=flying", "priority=urgent", "from=2026-02-30"]) {
    const res = await request.get(`${API_URL}/api/v1/operations/trips?${q}`, { headers });
    expect(res.status(), q).toBe(400);
  }
});

test("the summary endpoint refuses a caller who is not signed in", async ({ request }) => {
  const res = await request.get(`${API_URL}/api/v1/operations/trips/summary`);
  expect(res.status()).toBe(401);
});

/* ---------------------------------------------------------------------------
 * The pager against a synthetic server.
 *
 * A development database rarely holds more than a page of trips, so the cases
 * above that need a second page skip themselves. These give the page a server
 * with 130 trips (written to the real response shape) and check the page's own
 * behaviour: what it asks for, what it shows, and that the export follows every
 * page. The server's real paging, counting and filtering are covered against a
 * real database by backend/tests/tripListPaging.integration.test.js.
 * ------------------------------------------------------------------------- */

const TOTAL = 130;
const STATUSES = ["draft", "approved", "in_transit", "delivered"];
const fakeRow = (i) => ({
  trip_ticket_id: 1000 + i,
  ticket_no: `FAKE-${String(i).padStart(4, "0")}`,
  status: STATUSES[i % STATUSES.length],
  priority: "normal",
  customer_name: `Customer ${i}`,
  origin: "Origin",
  destination: "Destination",
  scheduled_departure: "2026-10-09 09:00:00",
});
// newest first, like the server
const FAKE = Array.from({ length: TOTAL }, (_, i) => fakeRow(TOTAL - i));

async function fakeServer(page) {
  const asked = [];
  await page.route("**/api/v1/operations/trips?*", async (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams;
    asked.push(Object.fromEntries(q));
    let rows = FAKE;
    if (q.get("status")) rows = rows.filter((r) => q.get("status").split(",").includes(r.status));
    if (q.get("search")) rows = rows.filter((r) => r.ticket_no.includes(q.get("search")));
    const limit = Number(q.get("limit")) || 20;
    const pg = Number(q.get("page")) || 1;
    await route.fulfill({
      json: {
        success: true,
        data: rows.slice((pg - 1) * limit, pg * limit),
        pagination: { page: pg, limit, total: rows.length, totalPages: Math.ceil(rows.length / limit) },
      },
    });
  });
  await page.route("**/api/v1/operations/trips/summary", (route) =>
    route.fulfill({ json: { success: true, data: { total: TOTAL, counts: { draft: 33, approved: 33, in_transit: 32, delivered: 32 }, barangays: [] } } }));
  return asked;
}

test.describe("with more than a page of trips", () => {
  test("shows the first twenty of 130 and the true total", async ({ page }) => {
    await fakeServer(page);
    await page.goto("/operations/trips");
    await page.getByRole("button", { name: "Table view" }).click();
    await expect(page.getByText("130 trips", { exact: true })).toBeVisible();
    await expect(page.getByText("Showing 1 to 20 of 130 entries")).toBeVisible();
    await expect(page.getByText("FAKE-0130")).toBeVisible();   // newest first
    await expect(page.getByText("FAKE-0111")).toBeVisible();   // the 20th
    await expect(page.getByText("FAKE-0110")).toHaveCount(0);  // the 21st is on page 2
  });

  test("walks to the next page and asks the server for exactly that page", async ({ page }) => {
    const asked = await fakeServer(page);
    await page.goto("/operations/trips");
    await page.getByRole("button", { name: "Table view" }).click();
    await expect(page.getByText("Showing 1 to 20 of 130 entries")).toBeVisible();
    await page.getByRole("button", { name: "2", exact: true }).click();
    await expect(page.getByText("Showing 21 to 40 of 130 entries")).toBeVisible();
    await expect(page.getByText("FAKE-0110")).toBeVisible();
    await expect(page.getByText("FAKE-0130")).toHaveCount(0);
    expect(asked.at(-1)).toMatchObject({ page: "2", limit: "20" });
  });

  test("a filter goes back to page 1 and the footer follows the filter", async ({ page }) => {
    const asked = await fakeServer(page);
    await page.goto("/operations/trips");
    await page.getByRole("button", { name: "Table view" }).click();
    // the pager shows "1 2 … 7" on the first page, so reach page 3 the way a user would
    await page.getByRole("button", { name: "2", exact: true }).click();
    await page.getByRole("button", { name: "3", exact: true }).click();
    await expect(page.getByText("Showing 41 to 60 of 130 entries")).toBeVisible();

    await page.getByRole("radio", { name: "Delivered" }).or(page.getByRole("button", { name: "Delivered", exact: true })).first().click();
    await expect.poll(() => asked.at(-1)).toMatchObject({ status: "delivered", page: "1" });
    await expect(page.getByText("32 trips", { exact: true })).toBeVisible();
    await expect(page.getByText("Showing 1 to 20 of 32 entries")).toBeVisible();
  });

  test("typing in the search sends one request after a pause, not one per keystroke", async ({ page }) => {
    const asked = await fakeServer(page);
    await page.goto("/operations/trips");
    await page.waitForLoadState("networkidle");
    const before = asked.length;
    await page.getByPlaceholder("Search trips…").pressSequentially("FAKE-01", { delay: 40 });
    await expect(page.getByText("Showing 1 to 20 of 31 entries").or(page.getByText("31 trips", { exact: true })).first()).toBeVisible();
    const searches = asked.slice(before).filter((r) => r.search);
    expect(searches).toHaveLength(1);
    expect(searches[0].search).toBe("FAKE-01");
  });

  test("Export CSV follows every page of the result, not just the one on screen", async ({ page }) => {
    const asked = await fakeServer(page);
    await page.goto("/operations/trips");
    await page.waitForLoadState("networkidle");
    const before = asked.length;
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    const text = await readFile(await download.path(), "utf8");
    const lines = text.trim().split("\r\n");
    expect(lines.length - 1).toBe(TOTAL);                       // all 130, not 20
    expect(new Set(lines.slice(1).map((l) => l.split(",")[0])).size).toBe(TOTAL); // none twice
    // only the export's own requests (100 per page): a background refresh of the list asks for 20
    const pages = asked.slice(before).filter((r) => r.limit === "100").map((r) => r.page);
    expect(pages).toEqual(["1", "2"]);                          // 130 trips at 100 per request
  });

  test("the export respects the filter in force", async ({ page }) => {
    const asked = await fakeServer(page);
    await page.goto("/operations/trips");
    await page.getByRole("radio", { name: "Delivered" }).or(page.getByRole("button", { name: "Delivered", exact: true })).first().click();
    await expect(page.getByText("32 trips", { exact: true })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    const lines = (await readFile(await download.path(), "utf8")).trim().split("\r\n");
    expect(lines.length - 1).toBe(32);
    expect(asked.at(-1)).toMatchObject({ status: "delivered" });
  });
});
