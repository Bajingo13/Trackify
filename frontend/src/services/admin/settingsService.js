import { get, patch, put } from "../apiClient";

/**
 * Company defaults and a person's own alert mutes.
 *
 * Only settings that something in the system actually reads are here. A
 * control that saves a value nothing consults looks like it works, which is
 * the worst way for it to be broken.
 */

export async function getCompanySettings() {
  const res = await get("/admin/settings/company");
  return res.data;
}

export async function updateCompanySettings(payload) {
  const res = await patch("/admin/settings/company", payload);
  return res.data;
}

export async function getAlertPreferences() {
  const res = await get("/admin/settings/alerts");
  return res.data;
}

export async function setAlertPreferences(muted) {
  const res = await put("/admin/settings/alerts", { muted });
  return res.data;
}

/** What the server is actually connected to — read, never set, from here. */
export async function getIntegrations() {
  const res = await get("/admin/settings/integrations");
  return res.data;
}
