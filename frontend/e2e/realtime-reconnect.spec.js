import { expect, test } from "@playwright/test";

import { installStaffSession } from "./helpers/staffSession.js";

/**
 * Dispatch polls the board every 60 s and also reacts to realtime events. The
 * hub does not replay what a client missed while its socket was down, so when
 * the socket comes back the page must refetch at once rather than wait for the
 * next poll. The outage is simulated by failing the realtime-ticket request and
 * closing the live socket, which works the same in every browser.
 */
test("Dispatch refetches the board as soon as the realtime socket reconnects", async ({ context, page }) => {
  await context.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.__trackifySockets = [];
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        window.__trackifySockets.push(this);
      }
    };
  });
  await installStaffSession(context);

  const boardRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/operations/dispatch/board")) boardRequests.push(Date.now());
  });

  await page.goto("/operations/dispatch");
  await expect(page.getByText("● live")).toBeVisible();

  // Take the realtime channel down: refuse new tickets, then drop the socket.
  await page.route("**/operations/tracking/realtime-ticket", (route) => route.abort());
  await page.evaluate(() => window.__trackifySockets.forEach((socket) => socket.close()));
  await expect(page.getByText("● polling")).toBeVisible();

  // Let it fail at least once so the reconnect is a recovery, not a first connect.
  await page.waitForTimeout(1500);
  const before = boardRequests.length;

  await page.unroute("**/operations/tracking/realtime-ticket");
  const restoredAt = Date.now();

  await expect(page.getByText("● live")).toBeVisible({ timeout: 15_000 });
  // The 60 s poll cannot explain a refetch this soon after reconnecting.
  await expect.poll(() => boardRequests.length, { timeout: 5_000 }).toBeGreaterThan(before);
  expect(boardRequests.at(-1) - restoredAt).toBeLessThan(20_000);
});
