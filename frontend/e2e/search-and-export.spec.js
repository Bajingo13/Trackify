import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { installStaffSession } from "./helpers/staffSession.js";

test.beforeEach(async ({ context }) => {
  await installStaffSession(context);
});

test("Ctrl+K opens search and Enter jumps to the page", async ({ page }) => {
  await page.goto("/dashboard");
  // the dashboard rebuilds its frame once its data arrives, which would reset
  // an open palette, so let the page settle first
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: /Search \(Ctrl\+K\)/ })).toBeVisible();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  await page.getByRole("combobox", { name: "Search" }).fill("vehicles");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/fleet\/vehicles$/);
  await expect(dialog).toBeHidden();
});

test("the top bar Search button opens it and Escape closes it", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /Search \(Ctrl\+K\)/ }).click();
  await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Search" })).toBeHidden();
});

test("Trips exports what is on screen as a CSV", async ({ page }) => {
  await page.goto("/operations/trips");
  await page.waitForLoadState("networkidle");
  const button = page.getByRole("button", { name: "Export CSV" });
  await expect(button).toBeVisible();
  test.skip(await button.isDisabled(), "no trips in this database to export");
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toMatch(/^Trips \d{4}-\d{2}-\d{2}\.csv$/);
  const text = await readFile(await download.path(), "utf8");
  expect(text.startsWith("\uFEFFTrip,Customer,Origin,Destination")).toBe(true);
  expect(text.trim().split("\r\n").length).toBeGreaterThan(1);
});
