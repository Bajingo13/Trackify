import { describe, expect, it } from "vitest";
import { applyLicenseScan, licenceDifferences, sameName } from "./applyLicenseScan";

const READ = {
  status: "read",
  fields: { licenseNo: "N01-12-345678", firstName: "Juan Santos", lastName: "Dela Cruz", licenseType: "Professional", licenseExpiry: "2031-01-15" },
  confidence: { licenseNo: "high", firstName: "high", lastName: "high", licenseType: "high", licenseExpiry: "low" },
};
const blank = { firstName: "", lastName: "", licenseNo: "", licenseType: "Non-Professional", licenseExpiry: "", contactNo: "0917" };

describe("applying an OCR proposal to the driver form", () => {
  it("fills an empty form and marks every value it supplied", () => {
    const result = applyLicenseScan(blank, READ);
    expect(result.form).toMatchObject({
      firstName: "Juan Santos", lastName: "Dela Cruz", licenseNo: "N01-12-345678",
      licenseType: "Professional", licenseExpiry: "2031-01-15", contactNo: "0917",
    });
    expect(result.marks).toEqual({ licenseNo: "high", licenseExpiry: "low", licenseType: "high", firstName: "high", lastName: "high" });
  });

  it("never blanks a field OCR did not find", () => {
    const partial = { status: "read", fields: { licenseNo: "N01-12-345678", licenseExpiry: null }, confidence: { licenseNo: "high" } };
    const result = applyLicenseScan({ ...blank, licenseExpiry: "2030-05-05" }, partial);
    expect(result.form.licenseExpiry).toBe("2030-05-05");
  });

  it("leaves an existing name for the Admin to review instead of silently replacing it", () => {
    const result = applyLicenseScan({ ...blank, firstName: "Pedro", lastName: "Morales" }, READ);
    expect(result.form.lastName).toBe("Morales");
    expect(result.nameNote).toMatch(/different from the name entered/);
  });

  it("does not change the form when reading failed", () => {
    const result = applyLicenseScan(blank, { status: "not_a_licence" });
    expect(result.form).toBe(blank);
    expect(result.filled).toBe(0);
  });
});

describe("name comparison used for review warnings", () => {
  it("ignores case, spacing and middle names", () => {
    expect(sameName("Juan", "Juan Santos")).toBe(true);
    expect(sameName("DELA  CRUZ", "Dela Cruz")).toBe(true);
    expect(sameName("Reyes", "Garcia")).toBe(false);
  });
});

describe("renewal differences", () => {
  it("lists only values that OCR proposes changing", () => {
    const differences = licenceDifferences({ licenseNo: "N01-12-345678", licenseType: "Professional", licenseExpiry: "2026-12-01" }, READ);
    expect(differences).toEqual([{ label: "Expiry", key: "licenseExpiry", current: "2026-12-01", scanned: "2031-01-15" }]);
  });

  it("offers nothing from a failed reading", () => {
    expect(licenceDifferences({}, { status: "not_a_licence" })).toEqual([]);
  });
});
