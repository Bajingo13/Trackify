import { expect, test } from "@playwright/test";

/**
 * Needs a production build: the staff service worker is not registered under
 * the Vite dev server. Serve one with `PORT=8450 node server.js` (after
 * `npm run build`) and point TRACKIFY_WEB_URL at it.
 *
 * localhost counts as a secure context, so no certificate is needed.
 */
test("the console opens on refresh while the network is down", async ({ context, page }) => {
  await page.goto("/login");
  await expect(page.locator("#root")).not.toBeEmpty();

  const registered = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((r) => setTimeout(() => r(null), 5000)),
    ]);
    return Boolean(reg);
  });
  test.skip(!registered, "staff service worker is not registered; run against a production build");

  // Reload once so the page is controlled by the worker and its assets are kept.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.reload();

  // The app booted from the cache rather than the browser's error page.
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.locator("#root *").first()).toBeVisible();

  // Coming back online restores normal loading.
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator("#root")).not.toBeEmpty();
});

test("control: without the worker the same offline refresh fails", async ({ context, page }) => {
  await page.goto("/login");
  await page.evaluate(async () => {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
    for (const key of await caches.keys()) await caches.delete(key);
  });
  await context.setOffline(true);
  await expect(page.reload()).rejects.toThrow(/ERR_INTERNET_DISCONNECTED|net::/);
  await context.setOffline(false);
});

test("the Driver App keeps its own worker and scope", async ({ page }) => {
  await page.goto("/driver");
  const scopes = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 1500));
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.map((r) => new URL(r.scope).pathname);
  });
  // The staff worker must not have been registered from the driver page.
  expect(scopes).not.toContain("/");
});
