import { afterEach, describe, expect, it, vi } from "vitest";

async function resolveOrigin({ apiUrl = "", driverApiUrl = "", native = false } = {}) {
  vi.resetModules();
  vi.stubEnv("VITE_API_URL", apiUrl);
  vi.stubEnv("VITE_DRIVER_API_URL", driverApiUrl);
  vi.stubGlobal("Capacitor", native ? { isNativePlatform: () => true } : undefined);

  const { API_ORIGIN } = await import("./apiOrigin.js");
  return API_ORIGIN;
}

describe("API_ORIGIN", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("honours a configured remote API and removes trailing slashes", async () => {
    expect(await resolveOrigin({ apiUrl: "https://api.trackify.test///" })).toBe(
      "https://api.trackify.test",
    );
  });

  it("ignores a loopback API when the page is served from another host", async () => {
    // A phone or tunnel must follow the page origin instead of calling itself.
    expect(await resolveOrigin({ apiUrl: "http://localhost:5000" })).toBe("");
  });

  it("uses the driver API configured for a native build", async () => {
    expect(
      await resolveOrigin({
        apiUrl: "https://web-api.trackify.test",
        driverApiUrl: "https://driver-api.trackify.test/",
        native: true,
      }),
    ).toBe("https://driver-api.trackify.test");
  });

  it("falls back to the Android emulator host when native has no API host", async () => {
    // This keeps native sign-in diagnosable instead of silently fetching its own WebView.
    expect(await resolveOrigin({ native: true })).toBe("http://10.0.2.2:5000");
  });
});
