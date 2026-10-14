import { describe, expect, it } from "vitest";
import { telHref } from "./telHref";

describe("telHref", () => {
  it("strips spacing and punctuation from a typed number", () => {
    expect(telHref("0917 123 4567")).toBe("tel:09171234567");
    expect(telHref("(02) 8123-4567")).toBe("tel:0281234567");
  });

  it("keeps the + of an international number", () => {
    expect(telHref("+63 917 123 4567")).toBe("tel:+639171234567");
  });

  it("dials only the first of several numbers, never a join of them", () => {
    expect(telHref("0917 123 4567 / 0918 765 4321")).toBe("tel:09171234567");
    expect(telHref("0917 123 4567, 0918 765 4321")).toBe("tel:09171234567");
    expect(telHref("(02) 8123-4567 loc 205")).toBe("tel:0281234567");
  });

  it("returns null when there is nothing to dial", () => {
    expect(telHref(null)).toBeNull();
    expect(telHref(undefined)).toBeNull();
    expect(telHref("")).toBeNull();
    expect(telHref("   ")).toBeNull();
    expect(telHref("n/a")).toBeNull();
    expect(telHref("123")).toBeNull();
    expect(telHref("1234567890123456")).toBeNull();
  });
});
