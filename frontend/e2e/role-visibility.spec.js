import { expect, test } from "@playwright/test";

import { installStaffSession } from "./helpers/staffSession.js";
import { restrictTo } from "./helpers/roles.js";

/**
 * Who sees "Invite User" and "New Client Setup".
 *
 * Both used to be "New User" / "New Company" and the release smoke test went
 * looking for the old names. Renaming them was right (users are invited by
 * email; a company is created through a whole client setup), but it left
 * nothing checking the part that matters more than the label: that the button
 * is there for the roles that should have it and for no one else.
 *
 * The console decides this from the permissions the server reports, so each
 * case runs as a role with exactly those permissions (see helpers/roles.js).
 * What the server refuses regardless is covered by the backend tests.
 */

const USERS = "/admin/settings/users";
const COMPANIES = "/admin/settings/companies";
const WIZARD = "/admin/settings/client-setup";

async function visit(page, route) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}
const button = (page, name) => page.getByRole("button", { name, exact: true });

test.describe("System Administrator", () => {
  test.beforeEach(async ({ context }) => installStaffSession(context));

  test("can invite users and start a new client setup", async ({ page }) => {
    await visit(page, USERS);
    await expect(button(page, "Invite User")).toBeVisible();
    await visit(page, COMPANIES);
    await expect(button(page, "New Client Setup")).toBeVisible();
  });

  test("reaches the client setup wizard", async ({ page }) => {
    await visit(page, WIZARD);
    await expect(page.getByRole("heading", { name: "New Client Setup" }).first()).toBeVisible();
  });
});

test.describe("a company administrator who is not a System Administrator", () => {
  test.beforeEach(async ({ context, page }) => {
    await installStaffSession(context);
    await restrictTo(context, page, ["company.read", "user.read", "user.manage"]);
  });

  test("can invite users", async ({ page }) => {
    await visit(page, USERS);
    await expect(button(page, "Invite User")).toBeVisible();
  });

  test("sees the companies but is not offered a new client setup", async ({ page }) => {
    await visit(page, COMPANIES);
    await expect(page.getByRole("heading", { name: "Companies" }).first()).toBeVisible();
    await expect(button(page, "New Client Setup")).toHaveCount(0);
  });

  test("is kept out of the wizard if they type its address", async ({ page }) => {
    await visit(page, WIZARD);
    await expect(page.getByRole("heading", { name: "New Client Setup" })).toHaveCount(0);
    await expect(page.getByLabel(/registered company name/i)).toHaveCount(0);
  });
});

test.describe("a read-only user manager", () => {
  test.beforeEach(async ({ context, page }) => {
    await installStaffSession(context);
    await restrictTo(context, page, ["user.read"]);
  });

  test("sees the users but cannot invite anyone", async ({ page }) => {
    await visit(page, USERS);
    await expect(page.getByRole("heading", { name: "Users" }).first()).toBeVisible();
    await expect(button(page, "Invite User")).toHaveCount(0);
  });
});

test.describe("a role with no access to user management", () => {
  test.beforeEach(async ({ context, page }) => {
    await installStaffSession(context);
    await restrictTo(context, page, ["vehicle.read"]);
  });

  test("gets neither page nor button", async ({ page }) => {
    await visit(page, USERS);
    await expect(button(page, "Invite User")).toHaveCount(0);
    await expect(page.getByPlaceholder("Search users…")).toHaveCount(0);

    await visit(page, COMPANIES);
    await expect(button(page, "New Client Setup")).toHaveCount(0);
  });
});
