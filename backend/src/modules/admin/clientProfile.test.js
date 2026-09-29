import { test } from "node:test";
import assert from "node:assert/strict";
import { readClientProfile } from "./clientProfile.js";

test("an empty profile is valid, stored as NULLs, with the country defaulted", () => {
  const { company, branch, problem } = readClientProfile({});
  assert.equal(problem, undefined);
  assert.equal(company.tin, null);
  assert.equal(company.email, null);
  assert.equal(company.country, "Philippines");
  assert.equal(branch.address_line, null);
});

test("a filled profile is trimmed and normalised", () => {
  const { company, branch } = readClientProfile({
    tradeName: "  ABL Freight ", businessType: "Corporation", industry: "Logistics & trucking",
    tin: "123-456-789-000", fleetSize: "42", companyEmail: "Ops@ABL.ph", companyPhone: "+63 2 8123 4567",
    website: "www.abl.ph", postalCode: "1226", paymentTerms: "Net 30", contractStart: "2026-10-01",
    branchPhone: "(082) 123-4567",
  });
  assert.equal(company.trade_name, "ABL Freight");
  assert.equal(company.fleet_size, 42);
  assert.equal(company.email, "ops@abl.ph");
  assert.equal(company.website, "https://www.abl.ph");
  assert.equal(branch.contact_number, "(082) 123-4567");
});

test("anything filled in but wrong is refused with a sentence about that field", () => {
  const cases = [
    [{ tin: "12345" }, /TIN/],
    [{ businessType: "Pirate" }, /business type/],
    [{ fleetSize: "-3" }, /Fleet size/],
    [{ companyEmail: "not-an-email" }, /company email/],
    [{ billingEmail: "x@" }, /billing email/],
    [{ companyPhone: "call me" }, /company phone/],
    [{ website: "nope" }, /website/],
    [{ postalCode: "ABC" }, /postal code/],
    [{ paymentTerms: "Whenever" }, /payment terms/],
    [{ contractStart: "2026-13-45" }, /contract start/],
  ];
  for (const [body, expected] of cases) {
    assert.match(readClientProfile(body).problem || "", expected, JSON.stringify(body));
  }
});
