import { beforeEach, describe, expect, test, vi } from "vitest";
import { post } from "./apiClient";

describe("temporary-access session enforcement", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test("a server-side password reset immediately tells the app to show the activation gate", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "Change your temporary password before using Trackify.",
      }),
    });
    const required = vi.fn();
    window.addEventListener("ttms:password-change-required", required, { once: true });

    await expect(post("/admin/example", {})).rejects.toThrow(/temporary password/i);
    expect(required).toHaveBeenCalledTimes(1);
  });
});
