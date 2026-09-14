import { afterEach, describe, expect, it, vi } from "vitest";
import { isNativeApp, platformName } from "./platform.js";

describe("platform detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports web when Capacitor is absent", () => {
    vi.stubGlobal("Capacitor", undefined);

    expect(isNativeApp()).toBe(false);
    expect(platformName()).toBe("web");
  });

  it("is native only when Capacitor says the platform is native", () => {
    vi.stubGlobal("Capacitor", {
      isNativePlatform: () => false,
      getPlatform: () => "web",
    });
    expect(isNativeApp()).toBe(false);

    vi.stubGlobal("Capacitor", {
      isNativePlatform: () => true,
      getPlatform: () => "android",
    });
    expect(isNativeApp()).toBe(true);
    expect(platformName()).toBe("android");
  });

  it("never leaks errors from a broken Capacitor bridge", () => {
    vi.stubGlobal("Capacitor", {
      isNativePlatform: () => {
        throw new Error("bridge unavailable");
      },
      getPlatform: () => {
        throw new Error("bridge unavailable");
      },
    });

    expect(() => isNativeApp()).not.toThrow();
    expect(isNativeApp()).toBe(false);
    expect(() => platformName()).not.toThrow();
    expect(platformName()).toBe("web");
  });
});
