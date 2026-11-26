import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Browser journeys live under e2e/ and are executed by Playwright. Keeping
    // Vitest on src prevents the two runners from trying to collect each
    // other's incompatible test APIs.
    include: ["src/**/*.test.{js,jsx,ts,tsx}"],
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "https://trackify.example/dashboard",
      },
    },
    setupFiles: ["./src/test/setup.js"],
    clearMocks: true,
    restoreMocks: true,
    // This suite creates a separate JSDOM environment for every test file.
    // Letting a 16-core machine start too many of them together starves async
    // renders and turns otherwise passing tests into five-second timeouts.
    maxWorkers: 4,
    testTimeout: 15_000,
  },
});
