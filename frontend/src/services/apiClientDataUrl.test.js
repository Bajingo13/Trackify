import { afterEach, describe, expect, it, vi } from "vitest";
import { getDataUrl } from "./apiClient";
import { getMyPhoto } from "./admin/accountService";

/**
 * "No photo" is the usual state of a profile, and the page asks on every
 * visit. It used to be a 404 each time — a failed request in the browser, the
 * logs and the release smoke test. The server now answers 204, and the client
 * must read that as "nothing to show", not as an empty picture.
 */

const answer = (status, body = null, headers = {}) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status, headers }));

afterEach(() => vi.restoreAllMocks());

describe("getDataUrl", () => {
  it("returns a data URL for a file", async () => {
    answer(200, "abc", { "Content-Type": "image/png" });
    expect(await getDataUrl("/x")).toMatch(/^data:image\/png;base64,/);
  });

  it("returns null for an empty 200, which is how the server says there is no photo", async () => {
    answer(200, "", { "Content-Type": "image/jpeg" });
    expect(await getDataUrl("/x")).toBeNull();
  });

  it("returns null for 204, not an empty data URL", async () => {
    answer(204);
    expect(await getDataUrl("/x")).toBeNull();
  });

  it("still throws for a missing file, carrying the status", async () => {
    answer(404, "{}");
    await expect(getDataUrl("/x")).rejects.toMatchObject({ status: 404 });
  });
});

describe("getMyPhoto", () => {
  it("is null when the server has no photo (an empty 200)", async () => {
    answer(200, "");
    expect(await getMyPhoto()).toBeNull();
  });

  it("is null when the server has no photo (204)", async () => {
    answer(204);
    expect(await getMyPhoto()).toBeNull();
  });

  it("is still null against a server that answers 404, so a rolling deploy is safe", async () => {
    answer(404, "{}");
    expect(await getMyPhoto()).toBeNull();
  });

  it("surfaces a real failure", async () => {
    answer(500, "{}");
    await expect(getMyPhoto()).rejects.toMatchObject({ status: 500 });
  });
});
