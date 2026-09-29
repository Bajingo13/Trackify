/**
 * The optional client profile collected by New Client Setup (migration 041).
 *
 * Only the company name and code are mandatory; everything here is optional,
 * but anything typed must be sensible — a phone number that is a phone
 * number, a TIN in the BIR's shape, one of the listed business types. Blank
 * fields are stored as NULL, never as empty strings.
 */

export const BUSINESS_TYPES = ["Corporation", "Partnership", "Sole proprietorship", "Cooperative", "Government", "Other"];
export const INDUSTRIES = [
  "Logistics & trucking", "Manufacturing", "Retail & distribution", "Food & beverage",
  "Construction", "Agriculture", "E-commerce", "Other",
];
export const PAYMENT_TERMS = ["Cash on delivery", "Net 15", "Net 30", "Net 45", "Net 60"];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// "+63 917 123 4567", "0917-123-4567", "(082) 123-4567"
const PHONE = /^\+?[0-9(][0-9 ()-]{5,18}[0-9]$/;
// BIR TIN: 9 digits, plus a 3–5 digit branch code; dashes optional.
const TIN = /^\d{3}-?\d{3}-?\d{3}(-?\d{3,5})?$/;
const POSTAL = /^\d{4,10}$/;

const text = (value, max) => {
  const s = String(value ?? "").trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Returns { company, branch } column values, or { problem } — the first
 * field that is filled in but not valid, in words for the person typing.
 */
export function readClientProfile(body = {}) {
  const company = {
    trade_name: text(body.tradeName, 200),
    business_type: text(body.businessType, 40),
    industry: text(body.industry, 60),
    tin: text(body.tin, 20),
    fleet_size: null,
    email: text(body.companyEmail, 200)?.toLowerCase() ?? null,
    phone: text(body.companyPhone, 40),
    website: text(body.website, 200),
    contact_name: text(body.contactName, 150),
    contact_position: text(body.contactPosition, 100),
    contact_phone: text(body.contactPhone, 40),
    address_line: text(body.addressLine, 255),
    barangay: text(body.barangay, 120),
    city: text(body.city, 120),
    province: text(body.province, 120),
    postal_code: text(body.postalCode, 10),
    country: text(body.country, 80) || "Philippines",
    billing_email: text(body.billingEmail, 200)?.toLowerCase() ?? null,
    payment_terms: text(body.paymentTerms, 30),
    contract_start: text(body.contractStart, 10),
    notes: text(body.notes, 1000),
  };
  const branch = {
    address_line: text(body.branchAddressLine, 255),
    city: text(body.branchCity, 120),
    province: text(body.branchProvince, 120),
    postal_code: text(body.branchPostalCode, 10),
    contact_number: text(body.branchPhone, 40),
  };

  const fail = (problem) => ({ problem });

  if (company.business_type && !BUSINESS_TYPES.includes(company.business_type)) return fail("Choose a business type from the list.");
  if (company.industry && !INDUSTRIES.includes(company.industry)) return fail("Choose an industry from the list.");
  if (company.tin && !TIN.test(company.tin)) return fail("Enter the TIN as 000-000-000 or 000-000-000-000.");

  if (body.fleetSize !== undefined && body.fleetSize !== null && String(body.fleetSize).trim() !== "") {
    const n = Number(body.fleetSize);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return fail("Fleet size must be a whole number of vehicles.");
    company.fleet_size = n;
  }

  if (company.email && !EMAIL.test(company.email)) return fail("Enter a valid company email address.");
  if (company.billing_email && !EMAIL.test(company.billing_email)) return fail("Enter a valid billing email address.");
  for (const [value, label] of [[company.phone, "company phone"], [company.contact_phone, "contact's phone"], [branch.contact_number, "branch phone"]]) {
    if (value && !PHONE.test(value)) return fail(`Enter a valid ${label} number, e.g. +63 917 123 4567.`);
  }
  if (company.website) {
    if (!/^https?:\/\//i.test(company.website)) company.website = `https://${company.website}`;
    try {
      const url = new URL(company.website);
      if (!url.hostname.includes(".")) throw new Error("no dot");
    } catch {
      return fail("Enter a valid website, e.g. www.company.com.");
    }
  }
  for (const [value, label] of [[company.postal_code, "postal code"], [branch.postal_code, "branch postal code"]]) {
    if (value && !POSTAL.test(value)) return fail(`Enter a valid ${label} (numbers only, e.g. 1226).`);
  }
  if (company.payment_terms && !PAYMENT_TERMS.includes(company.payment_terms)) return fail("Choose payment terms from the list.");
  if (company.contract_start && (!/^\d{4}-\d{2}-\d{2}$/.test(company.contract_start) || Number.isNaN(Date.parse(company.contract_start)))) {
    return fail("Enter a valid contract start date.");
  }

  return { company, branch };
}
