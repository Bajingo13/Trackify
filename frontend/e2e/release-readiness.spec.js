import { expect, test } from "@playwright/test";

import { FIRST_PARTY_ORIGINS, installStaffSession } from "./helpers/staffSession.js";

/**
 * Every staff route mounted by App.jsx. Keeping this list explicit makes a new
 * route an intentional QA decision instead of silently trusting navigation UI.
 */
const STAFF_ROUTES = [
  "/dashboard",
  "/operations/trips",
  "/operations/dispatch",
  "/operations/live-tracking",
  "/operations/exceptions",
  "/fleet/vehicles",
  "/fleet/drivers",
  "/fleet/maintenance",
  "/fleet/availability",
  "/fleet/compliance",
  "/warehouse/inventory",
  "/warehouse/stock-movements",
  "/warehouse/transfers",
  "/warehouse/cargo-release",
  "/warehouse/cargo-return",
  "/finance/trip-expenses",
  "/finance/expense-vouchers",
  "/finance/invoices",
  "/finance/journal-entries",
  "/finance/bir-eis",
  "/master-data/customers",
  "/master-data/suppliers",
  "/master-data/items",
  "/master-data/warehouses",
  "/master-data/chart-of-accounts",
  "/master-data/tax-codes",
  "/reports/operations",
  "/reports/fleet",
  "/reports/expenses",
  "/reports/financial",
  "/reports/compliance",
  "/admin/audit-logs",
  "/admin/settings",
  "/admin/settings/profile",
  "/admin/settings/preferences",
  "/admin/settings/notifications",
  "/admin/settings/companies",
  "/admin/settings/branches",
  "/admin/settings/users",
  "/admin/settings/roles",
  "/admin/settings/integrations",
  "/admin/settings/general",
  "/admin/settings/audit-logs",
];

/**
 * Only actions known to open an empty create form are included. In particular,
 * workflow actions such as Approve, Dispatch, Post, Send, and Delete are never
 * selected by a broad button matcher.
 */
const SAFE_PRIMARY_ACTIONS = {
  "/operations/trips": "New Trip",
  "/operations/exceptions": "Raise Exception",
  "/fleet/vehicles": "Add Vehicle",
  "/fleet/drivers": "Add Driver",
  "/fleet/maintenance": "Schedule Maintenance",
  "/fleet/compliance": "Record Document",
  "/warehouse/inventory": "Add Item",
  "/warehouse/transfers": "New Transfer",
  "/finance/trip-expenses": "Record Expense",
  "/finance/expense-vouchers": "New Voucher",
  "/finance/invoices": "New Invoice",
  "/finance/journal-entries": "New Entry",
  "/finance/bir-eis": "Add Record",
  "/master-data/customers": "New Customer",
  "/master-data/suppliers": "New",
  "/master-data/items": "New",
  "/master-data/warehouses": "New",
  "/master-data/chart-of-accounts": "New",
  "/master-data/tax-codes": "New",
  "/admin/settings/branches": "New Branch",
  // Users are invited by email now (there is no password to set), so the
  // button says so.
  "/admin/settings/users": "Invite User",
  "/admin/settings/roles": "New Role",
};

/**
 * Actions that leave the page rather than open a form on it. Companies are
 * created through the New Client Setup wizard — company, profile, first branch,
 * roles and administrator together — so the button navigates; there is no
 * Cancel to press. The check is that it lands on the wizard and can come back.
 */
const NAVIGATING_ACTIONS = {
  "/admin/settings/companies": { name: "New Client Setup", lands: /\/admin\/settings\/client-setup$/, heading: "New Client Setup" },
};

const IGNORED_CONSOLE_ERRORS = [
  /Download the React DevTools/i,
  /React Router Future Flag/i,
  /favicon/i,
  /MapLibre|maplibre/i,
  /WebGL|webgl/i,
  /openfreemap/i,
  // Playwright's response listener below records the exact first-party URL;
  // Chromium's generic console copy adds no actionable detail.
  /Failed to load resource: the server responded with a status of [45]\d\d/i,
];

function watchForRuntimeFailures(page) {
  const failures = [];

  page.on("pageerror", (error) => {
    failures.push(`page exception: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (!IGNORED_CONSOLE_ERRORS.some((pattern) => pattern.test(text))) {
      failures.push(`console error: ${text}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && FIRST_PARTY_ORIGINS.has(new URL(response.url()).origin)) {
      failures.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/")) {
      failures.push(`API request failed: ${request.method()} ${request.url()}`);
    }
  });

  return failures;
}

async function expectStaffPageReady(page, route) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await expect(page).toHaveURL(new RegExp(`${escapedRoute}$`));
  await expect(page.locator("main").first()).toBeVisible();
  await expect
    .poll(async () => (await page.locator("main").first().innerText()).trim().length)
    .toBeGreaterThan(40);
  await expect(page.getByText(/access denied|not authorized|don't have permission/i)).toHaveCount(0);

  // Allow lazy API work and React effects to surface failures before assessment.
  await page.waitForTimeout(1_200);
}

async function openAndLeavePrimaryAction(page, route, { name, lands, heading }) {
  await page.getByRole("button", { name, exact: true }).first().click();
  await expect(page).toHaveURL(lands);
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
}

async function openAndCancelPrimaryAction(page, actionName) {
  const action = page.getByRole("button", { name: actionName, exact: true }).first();
  await expect(action).toBeVisible();
  await action.click();

  // Every allow-listed action has a non-mutating Cancel exit, including the
  // two full-page create forms used by Vehicles and Drivers.
  const cancel = page.getByRole("button", { name: "Cancel", exact: true }).last();
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(cancel).toBeHidden();
}

test.describe("staff login controls", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test("password visibility and remembered-email controls work without a real sign-in", async ({ page }) => {
    const email = page.getByLabel("Email address");
    const password = page.getByLabel("Password", { exact: true });

    await expect(email).toBeVisible();
    await expect(password).toHaveAttribute("type", "password");
    await password.fill("qa-not-a-secret");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");

    // Stub the response so this control test cannot consume the login-rate
    // limit or expose an environment-supplied credential in Playwright traces.
    await page.route("**/api/auth/login", (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: '{"message":"Expected QA rejection"}' }),
    );
    await email.fill("remember-me@example.test");
    await password.fill("qa-not-a-secret");
    await page.getByLabel("Remember me").uncheck();
    await page.getByRole("button", { name: "Sign in securely" }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("tk_login_remember"))).toBe("0");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("tk_login_email"))).toBeNull();
  });

  test("forgot-password opens the recovery screen and gives a non-enumerating confirmation", async ({ page }) => {
    // Stub delivery so browser QA proves the workflow without sending mail or
    // revealing whether the test address belongs to a real account.
    await page.route("**/api/auth/forgot-password", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"success":true,"message":"If that address belongs to an account, a reset link is on its way."}',
      }),
    );

    // A button, not a link: it swaps the sign-in card for the reset form in
    // place, so the address typed so far carries over and the URL stays /login.
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
    await page.getByLabel("Email address").fill("browser-qa@example.test");
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page.getByRole("heading", { name: "Link sent" })).toBeVisible();
    await expect(page.getByText(/if that address belongs to an account/i)).toBeVisible();
  });

  test("the standalone /forgot-password page still works for links that point at it", async ({ page }) => {
    // The reset page links here when a token has expired, so the route has to
    // keep working even though the sign-in card now does this in place.
    await page.route("**/api/auth/forgot-password", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"success":true}' }),
    );
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
    await page.getByLabel("Email address").fill("browser-qa@example.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Link sent" })).toBeVisible();
  });

  test("a valid reset link exposes a usable password form", async ({ page }) => {
    // Both calls are stubbed: this checks the browser controls without changing
    // an account or asking the undecided mail provider to deliver anything.
    await page.route("**/api/auth/reset-password*", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: '{"success":true,"data":{"email":"b***@example.test"}}',
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"success":true}' });
    });

    await page.goto("/reset-password?token=browser-qa-token");
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await page.getByLabel("New password", { exact: true }).fill("Browser QA phrase 2026!");
    await page.getByLabel("Repeat new password").fill("Browser QA phrase 2026!");
    await page.getByRole("button", { name: "Change my password" }).click();
    await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();
  });
});

test.describe("authenticated staff route smoke", () => {
  test.beforeEach(async ({ context }) => {
    await installStaffSession(context);
  });

  for (const route of STAFF_ROUTES) {
    test(`${route} renders cleanly`, async ({ page }) => {
      const failures = watchForRuntimeFailures(page);
      await expectStaffPageReady(page, route);

      const actionName = SAFE_PRIMARY_ACTIONS[route];
      if (actionName) {
        await test.step(`open and cancel ${actionName}`, async () => {
          await openAndCancelPrimaryAction(page, actionName);
        });
      }

      const leaving = NAVIGATING_ACTIONS[route];
      if (leaving) {
        await test.step(`open ${leaving.name} and come back`, async () => {
          await openAndLeavePrimaryAction(page, route, leaving);
        });
      }

      expect(failures, failures.join("\n")).toEqual([]);
    });
  }
});

test.describe("global shell controls", () => {
  test.beforeEach(async ({ context }) => {
    await installStaffSession(context);
  });

  test("theme, sidebar, navigation mode, notifications, and account menu remain usable", async ({ page }) => {
    const failures = watchForRuntimeFailures(page);
    await expectStaffPageReady(page, "/dashboard");

    await page.getByTitle("Dark theme").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("tk_theme"))).toBe("dark");

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("tk_sidebar"))).toBe("collapsed");

    await page.getByRole("button", { name: "Toggle navigation layout" }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("tk_nav_mode"))).toBe("top");
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toHaveCount(0);

    await page.getByRole("button", { name: /^Notifications(?: \(\d+\))?$/ }).click();
    await expect(page.getByText("Notifications", { exact: true }).last()).toBeVisible();
    await page.keyboard.press("Escape");

    const profileButton = page.locator("header").getByRole("button").last();
    await profileButton.click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Account Settings" })).toBeVisible();

    expect(failures, failures.join("\n")).toEqual([]);
  });
});
