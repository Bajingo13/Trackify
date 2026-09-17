import { expect, test } from "@playwright/test";

const API_URL = (process.env.TRACKIFY_API_URL || "http://localhost:5001").replace(/\/$/, "");
const WEB_URL = (process.env.TRACKIFY_WEB_URL || "http://localhost:8444").replace(/\/$/, "");
const STAFF_EMAIL = process.env.TRACKIFY_TEST_EMAIL || "superadmin@gmail.com";
const STAFF_PASSWORD = process.env.TRACKIFY_TEST_PASSWORD || "demo123";
const FIRST_PARTY_ORIGINS = new Set([new URL(WEB_URL).origin, new URL(API_URL).origin]);

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
  "/admin/settings/companies": "New Company",
  "/admin/settings/branches": "New Branch",
  "/admin/settings/users": "New User",
  "/admin/settings/roles": "New Role",
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

let seededSessionPromise;

async function loadSeededStaffSession() {
  if (!seededSessionPromise) {
    seededSessionPromise = (async () => {
      let response;
      try {
        response = await fetch(`${API_URL}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: STAFF_EMAIL, password: STAFF_PASSWORD }),
        });
      } catch {
        throw new Error(
          `Trackify API is unavailable at ${API_URL}. Start the local backend or set TRACKIFY_API_URL.`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `Staff test login returned HTTP ${response.status}. Set TRACKIFY_TEST_EMAIL and TRACKIFY_TEST_PASSWORD to a seeded staff account.`,
        );
      }

      const body = await response.json();
      const data = body?.data;
      if (!data?.token || !data?.user) {
        throw new Error("Staff test login succeeded without the expected user session payload.");
      }

      const user = {
        ...data.user,
        token: data.token,
        access: data.access || [],
        roles: data.roles || [],
        permissions: data.permissions || [],
      };
      const scope = user.access.find((item) => item.branch_id) || user.access[0] || {};
      return {
        user,
        companyId: scope.company_id || null,
        branchId: scope.branch_id || null,
      };
    })();
  }
  return seededSessionPromise;
}

async function installStaffSession(context) {
  const session = await loadSeededStaffSession();
  await context.addInitScript((state) => {
    localStorage.setItem("ttms_auth", JSON.stringify(state.user));
    if (state.companyId) localStorage.setItem("ttms_company_id", state.companyId);
    else localStorage.removeItem("ttms_company_id");
    if (state.branchId) localStorage.setItem("ttms_branch_id", state.branchId);
    else localStorage.removeItem("ttms_branch_id");
  }, session);
}

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

  test.fixme("forgot-password starts a real account-recovery flow", async () => {
    // The current link is href="#" and no recovery screen or endpoint exists.
    // Keep this visible in --list output until the product flow is implemented.
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
