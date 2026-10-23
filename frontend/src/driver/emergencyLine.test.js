import { beforeEach, describe, expect, it, vi } from "vitest";
import { cachedEmergencyLine, dialHref, rememberEmergencyLine } from "./emergencyLine";

describe("the emergency line kept on the phone", () => {
  beforeEach(() => localStorage.clear());

  it("keeps what the server sent, for that driver only", () => {
    rememberEmergencyLine(7, { number: "(082) 224-1234", isDemo: false });
    expect(cachedEmergencyLine(7)).toMatchObject({ number: "(082) 224-1234", isDemo: false });
    expect(cachedEmergencyLine(8)).toBeNull();
  });

  it("keeps 'none set' too, and the demo label", () => {
    rememberEmergencyLine(7, { number: null, isDemo: false });
    expect(cachedEmergencyLine(7)).toMatchObject({ number: null });
    rememberEmergencyLine(7, { number: "+63 900 000 0000", isDemo: true });
    expect(cachedEmergencyLine(7)).toMatchObject({ number: "+63 900 000 0000", isDemo: true });
  });

  it("is nothing before it has ever loaded, or for no driver", () => {
    expect(cachedEmergencyLine(7)).toBeNull();
    expect(cachedEmergencyLine(null)).toBeNull();
    rememberEmergencyLine(null, { number: "911" });
    expect(localStorage.length).toBe(0);
  });

  it("survives storage that is full, blocked or holding junk", () => {
    localStorage.setItem("trackify-driver-emergency-line:7", "{not json");
    expect(cachedEmergencyLine(7)).toBeNull();

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });
    expect(() => rememberEmergencyLine(7, { number: "911" })).not.toThrow();
    setItem.mockRestore();
  });
});

describe("the Call link", () => {
  it("dials short hotlines and full numbers alike", () => {
    expect(dialHref("911")).toBe("tel:911");
    expect(dialHref("(082) 224-1234")).toBe("tel:0822241234");
    expect(dialHref("+63 900 000 0000")).toBe("tel:+639000000000");
  });

  it("offers nothing for something that cannot be dialled", () => {
    expect(dialHref("")).toBeNull();
    expect(dialHref(null)).toBeNull();
    expect(dialHref("12")).toBeNull();
    expect(dialHref("1234567890123456")).toBeNull();
  });
});
