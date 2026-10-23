import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearDraft, DRAFT_MAX_AGE_MS, loadDraft, saveDraft } from "./formDraft";

describe("a form's draft on the phone", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the values and the form's reference, per driver and per form", () => {
    saveDraft(7, "claim", { amount: "350" }, "ref-abc12345");
    expect(loadDraft(7, "claim")).toMatchObject({ values: { amount: "350" }, clientRef: "ref-abc12345" });
    expect(loadDraft(8, "claim")).toBeNull();
    expect(loadDraft(7, "support")).toBeNull();
  });

  it("is gone once cleared", () => {
    saveDraft(7, "claim", { amount: "350" }, "ref-abc12345");
    clearDraft(7, "claim");
    expect(loadDraft(7, "claim")).toBeNull();
  });

  it("is dropped after a week", () => {
    saveDraft(7, "claim", { amount: "350" }, "ref-abc12345");
    const savedAt = loadDraft(7, "claim").savedAt;
    expect(loadDraft(7, "claim", savedAt + DRAFT_MAX_AGE_MS)).not.toBeNull();
    expect(loadDraft(7, "claim", savedAt + DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(localStorage.getItem("trackify-driver-draft:7:claim")).toBeNull();
  });

  it("does nothing without a driver", () => {
    saveDraft(null, "claim", { amount: "350" }, "ref");
    expect(localStorage.length).toBe(0);
    expect(loadDraft(null, "claim")).toBeNull();
  });

  it("survives storage that is junk, full or blocked", () => {
    localStorage.setItem("trackify-driver-draft:7:claim", "{nope");
    expect(loadDraft(7, "claim")).toBeNull();
    localStorage.setItem("trackify-driver-draft:7:claim", JSON.stringify({ values: null }));
    expect(loadDraft(7, "claim")).toBeNull();

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    expect(() => saveDraft(7, "claim", { amount: "1" }, "ref")).not.toThrow();
    setItem.mockRestore();
  });
});
