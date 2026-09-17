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
  },
});
