import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const baseURL = process.env.TRACKIFY_WEB_URL || "http://localhost:8444";
const artifactRoot = path.join(os.tmpdir(), "trackify-playwright");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(artifactRoot, "test-results"),
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(artifactRoot, "report"), open: "never" }],
  ],
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    headless: true,
    viewport: { width: 1600, height: 1000 },
    ignoreHTTPSErrors: false,
    screenshot: "only-on-failure",
    // Authenticated traces can contain bearer tokens in request headers. Keep
    // them opt-in and store them only in the OS temp directory above.
    trace: process.env.TRACKIFY_E2E_TRACE === "1" ? "retain-on-failure" : "off",
    video: "off",
  },
});
