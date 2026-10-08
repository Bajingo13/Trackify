import { expect, test } from "@playwright/test";

import { API_URL, installStaffSession, loadSeededStaffSession } from "./helpers/staffSession.js";
import { restrictTo } from "./helpers/roles.js";

/**
 * Ctrl+K search for people who must not see trips.
 *
 * The palette hides trip search from a role without trip.read, but hiding is a
 * courtesy — the server is what actually refuses. These check both layers: the
 * browser never even asks when the role can't read trips, and the API itself
 * says no to anyone it should.
 */

const SEARCH_URL = "**/api/v1/operations/trips/search*";

/** A role that can open Vehicles and nothing about trips. */
const RESTRICTED = ["vehicle.read", "customer.read"];

async function openPalette(page) {
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  return { dialog, input: page.getByRole("combobox", { name: "Search" }) };
}

test.describe("a role without trip.read", () => {
  test.beforeEach(async ({ context, page }) => {
    await installStaffSession(context);
    await restrictTo(context, page, RESTRICTED);
  });

  test("gets a pages-only palette and the browser never asks for trips", async ({ page }) => {
    const asked = [];
    page.on("request", (r) => { if (/\/operations\/trips/.test(r.url())) asked.push(r.url()); });

    await page.goto("/fleet/vehicles");
    const { input } = await openPalette(page);

    await expect(input).toHaveAttribute("placeholder", "Search pages…");
    await input.fill("TT-00");
    // longer than the debounce, so a request would have been sent by now
    await page.waitForTimeout(800);
    expect(asked).toEqual([]);
    await expect(page.getByText("Searching trips…")).toHaveCount(0);
  });

  test("still finds the pages it may open, and not the ones it may not", async ({ page }) => {
    await page.goto("/fleet/vehicles");
    const { input } = await openPalette(page);

    await input.fill("trips");
    await expect(page.getByRole("option", { name: /^Trips/ })).toHaveCount(0);
    await expect(page.getByText("No matches")).toBeVisible();

    await input.fill("vehicles");
    await expect(page.getByRole("option", { name: /Vehicles/ })).toBeVisible();
  });
});

test.describe("when the server refuses anyway", () => {
  test.beforeEach(async ({ context }) => {
    await installStaffSession(context);
  });

  test("the palette says so plainly, keeps pages usable, and does not claim 'No matches'", async ({ page }) => {
    await page.route(SEARCH_URL, (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ success: false, message: "You do not have permission to perform this action." }),
      }),
    );

    await page.goto("/fleet/vehicles");
    const { input } = await openPalette(page);
    await input.fill("vehicles");

    await expect(page.getByText("You don't have permission to search trips.")).toBeVisible();
    await expect(page.getByText("No matches")).toHaveCount(0);
    // a refusal is final, so there is nothing to retry
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);

    await expect(page.getByRole("option", { name: /Vehicles/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/fleet\/vehicles$/);
  });

  test("a server error is retryable and is not shown as 'No matches'", async ({ page }) => {
    let calls = 0;
    await page.route(SEARCH_URL, (route) => {
      calls += 1;
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, message: "boom" }) });
    });

    await page.goto("/fleet/vehicles");
    const { input } = await openPalette(page);
    await input.fill("TT-00");

    await expect(page.getByText(/Couldn't search trips/)).toBeVisible();
    await expect(page.getByText("No matches")).toHaveCount(0);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => calls).toBeGreaterThanOrEqual(2);
  });
});

test.describe("the trip search endpoint itself", () => {
  const headers = (session, over = {}) => ({
    Authorization: `Bearer ${session.user.token}`,
    "X-Company-Id": String(session.companyId),
    "X-Branch-Id": String(session.branchId),
    ...over,
  });
  const url = (q = "TT") => `${API_URL}/api/v1/operations/trips/search?q=${encodeURIComponent(q)}`;

  test("refuses a request with no sign-in", async ({ request }) => {
    const session = await loadSeededStaffSession();
    const res = await request.get(url(), { headers: { "X-Company-Id": String(session.companyId), "X-Branch-Id": String(session.branchId) } });
    expect(res.status()).toBe(401);
  });

  test("refuses a token that is not a staff token", async ({ request }) => {
    const session = await loadSeededStaffSession();
    const res = await request.get(url(), { headers: headers(session, { Authorization: "Bearer not-a-real-token" }) });
    expect(res.status()).toBe(401);
  });

  test("answers an empty list, not an error, for a term that is too short", async ({ request }) => {
    const session = await loadSeededStaffSession();
    const res = await request.get(url("a"), { headers: headers(session) });
    expect(res.status()).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });

  test("returns only the lean fields, and never more than asked for", async ({ request }) => {
    const session = await loadSeededStaffSession();
    const res = await request.get(`${url("TT")}&limit=2`, { headers: headers(session) });
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBeLessThanOrEqual(2);
    for (const row of data) {
      expect(Object.keys(row).sort()).toEqual(["customer_name", "destination", "origin", "ticket_no", "trip_ticket_id"]);
    }
  });

  test("will not search a branch the caller does not belong to", async ({ request }) => {
    const session = await loadSeededStaffSession();
    const res = await request.get(url(), { headers: headers(session, { "X-Branch-Id": "999999" }) });
    expect([400, 403]).toContain(res.status());
  });

  test("a wildcard typed by a person is not a match-everything", async ({ request }) => {
    const session = await loadSeededStaffSession();
    const res = await request.get(url("%"), { headers: headers(session) });
    expect(res.status()).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });
});

test.describe("search through the real endpoint", () => {
  test.beforeEach(async ({ context }) => {
    await installStaffSession(context);
  });

  test("a real ticket number typed into the palette is found", async ({ page, request }) => {
    const session = await loadSeededStaffSession();
    const list = await request.get(`${API_URL}/api/v1/operations/trips?limit=1`, {
      headers: {
        Authorization: `Bearer ${session.user.token}`,
        "X-Company-Id": String(session.companyId),
        "X-Branch-Id": String(session.branchId),
      },
    });
    const first = (await list.json()).data?.[0];
    test.skip(!first, "no trips in this database to search for");

    await page.goto("/fleet/vehicles");
    const { input } = await openPalette(page);
    await input.fill(first.ticket_no);
    await expect(page.getByRole("option", { name: new RegExp(first.ticket_no) })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/operations\/trips/);
  });
});
