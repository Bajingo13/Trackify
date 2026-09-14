import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
