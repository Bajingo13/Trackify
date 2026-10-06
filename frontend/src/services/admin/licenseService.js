import { get, post } from "../apiClient";

/** The license of the company you are operating in. */
export async function getMyLicense() {
  const res = await get("/admin/license");
  return res.data;
}

/** Every client's license (System Administrator only). */
export async function listLicenses() {
  const res = await get("/admin/licenses");
  return res.data || [];
}

export async function issueLicense(companyId, termMonths) {
  const res = await post(`/admin/companies/${companyId}/license`, { termMonths });
  return res.data;
}

export async function renewLicense(companyId, termMonths) {
  const res = await post(`/admin/companies/${companyId}/license/renew`, { termMonths });
  return res.data;
}

export async function revokeLicense(companyId, reason) {
  const res = await post(`/admin/companies/${companyId}/license/revoke`, { reason });
  return res.data;
}

export async function reinstateLicense(companyId) {
  const res = await post(`/admin/companies/${companyId}/license/reinstate`, {});
  return res.data;
}
