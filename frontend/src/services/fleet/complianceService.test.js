import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apiClient", () => ({
  get: vi.fn(),
  post: vi.fn(),
}));

import { get, post } from "../apiClient";
import {
  createComplianceDocument,
  getFilteredComplianceAlerts,
  moduleForComplianceDocument,
} from "./complianceService";

const row = (docType, entityId) => ({
  entity_type: "vehicle",
  entity_id: entityId,
  entity_label: `TRK-${entityId}`,
  doc_type: docType,
  expiry_date: "2027-01-15",
  days_to_expiry: 60,
  compliance_status: "valid",
});

describe("compliance document mapping", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("routes roadworthiness documents into the Maintenance filter", async () => {
    // Safety inspections and emissions checks were previously impossible to
    // find because every backend row was hard-coded to the Fleet module.
    get.mockResolvedValue({
      data: [
        row("Registration (OR/CR)", 1),
        row("Annual Safety Inspection", 2),
        row("Emissions Test", 3),
      ],
      stats: {},
    });

    const alerts = await getFilteredComplianceAlerts({ module: "Maintenance" });

    expect(alerts.map((alert) => alert.entityId)).toEqual([2, 3]);
    expect(alerts.every((alert) => alert.module === "Maintenance")).toBe(true);
  });

  it("keeps registration, insurance, permits, and driver credentials under Fleet", () => {
    expect(moduleForComplianceDocument("Registration (OR/CR)")).toBe("Fleet");
    expect(moduleForComplianceDocument("Insurance")).toBe("Fleet");
    expect(moduleForComplianceDocument("Special Permit")).toBe("Fleet");
    expect(moduleForComplianceDocument("Driver Licence")).toBe("Fleet");
  });

  it("uses the existing protected endpoint when a manager records a document", async () => {
    post.mockResolvedValue({ success: true, data: { documentId: 44 } });
    const document = {
      entityType: "vehicle",
      entityId: 7,
      docType: "Safety Inspection",
      expiryDate: "2027-01-15",
    };

    await createComplianceDocument(document);

    expect(post).toHaveBeenCalledWith("/fleet/compliance/documents", document);
  });
});
