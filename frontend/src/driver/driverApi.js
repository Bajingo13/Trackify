import { enqueue, flush, isOnline } from "./offlineQueue";

import { API_ORIGIN } from "../services/apiOrigin";

const BASE = `${API_ORIGIN}/api/v1/driver`;
const KEY = "ttms_driver_auth";

export const getDriverAuth = () => {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
};
export const setDriverAuth = (a) => localStorage.setItem(KEY, JSON.stringify(a));
export const clearDriverAuth = () => localStorage.removeItem(KEY);

async function req(path, opts = {}) {
  const auth = getDriverAuth();
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  const r = await fetch(BASE + path, { ...opts, headers });
  let data = {};
  try { data = await r.json(); } catch { /* empty */ }
  if (r.status === 401 && !path.startsWith("/auth")) {
    clearDriverAuth();
    window.location.assign("/driver");
    throw new Error("Session expired");
  }
  if (!r.ok) {
    const e = new Error(data.message || "Something went wrong");
    e.status = r.status;
    throw e;
  }
  return data;
}

export const driverLogin = (employeeNo, pin) =>
  req("/auth/login", { method: "POST", body: JSON.stringify({ employeeNo, pin }) });
export const driverTrips = () => req("/trips").then((d) => d.data || []);
export const driverTrip = (id) => req(`/trips/${id}`).then((d) => d.data);
/**
 * Anything the driver files from the road goes through here. Out of coverage
 * it is parked in the outbox and replayed later, so a dead zone never silently
 * swallows a delivery or an expense.
 */
async function sendOrQueue(kind, path, { json, form } = {}) {
  if (!isOnline()) {
    await enqueue({ kind, path, json: json || null, form: form ? await formToParts(form) : null });
    return { queued: true };
  }
  try {
    return json
      ? await req(path, { method: "POST", body: JSON.stringify(json) })
      : await postForm(path, form);
  } catch (e) {
    // a transport failure means it never reached the server — keep it
    if (e.status == null) {
      await enqueue({ kind, path, json: json || null, form: form ? await formToParts(form) : null });
      return { queued: true };
    }
    throw e;
  }
}

/** FormData cannot be stored directly, so it is broken into storable parts. */
async function formToParts(form) {
  const parts = [];
  for (const [k, v] of form.entries()) {
    if (v instanceof File || v instanceof Blob) {
      parts.push({ k, file: { blob: v, name: v.name || "upload", type: v.type } });
    } else {
      parts.push({ k, v: String(v) });
    }
  }
  return parts;
}

function partsToForm(parts) {
  const form = new FormData();
  for (const p of parts) {
    if (p.file) form.append(p.k, p.file.blob, p.file.name);
    else form.append(p.k, p.v);
  }
  return form;
}

async function postForm(path, form) {
  const auth = getDriverAuth();
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: auth?.token ? { Authorization: `Bearer ${auth.token}` } : {},
    body: form,
  });
  let data = {};
  try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) {
    const e = new Error(data.message || "Could not send that.");
    e.status = r.status;
    throw e;
  }
  return data;
}

/** Replays the outbox. Called when the browser reports it is back online. */
export const flushOutbox = () =>
  flush(async (row) => {
    if (row.form) return postForm(row.path, partsToForm(row.form));
    return req(row.path, { method: "POST", body: JSON.stringify(row.json || {}) });
  });

export const driverPing = (id, body) => sendOrQueue("ping", `/trips/${id}/ping`, { json: body });
export const driverStart = (id) => sendOrQueue("start", `/trips/${id}/start`, { json: {} });

/** Reached a waypoint. Queued when offline, like every other filed record. */
export const driverArriveAtStop = (tripId, stopId, body) =>
  sendOrQueue("stop", `/trips/${tripId}/stops/${stopId}/arrive`, { json: body || {} });

/** Proof of delivery: who received it, where the driver was, and a photo. */
export const driverDeliver = (id, form) => sendOrQueue("deliver", `/trips/${id}/deliver`, { form });

/* ---- expenses logged from the road ---- */

export const driverExpenses = (tripId) =>
  req(`/trips/${tripId}/expenses`).then((d) => d.data || []);

/** multipart: the browser sets its own boundary, so no Content-Type here */
export async function driverSubmitExpense(tripId, form) {
  const out = await sendOrQueue("expense", `/trips/${tripId}/expenses`, { form });
  return out?.queued ? { queued: true } : out?.data;
}

/* ---- the driver's own account ---- */

export const driverMe = () => req("/me").then((d) => d.data);

/** Only the fields a driver owns. The licence is read-only by design. */
export const driverUpdateMe = (body) =>
  req("/me", { method: "PATCH", body: JSON.stringify(body) }).then((d) => d.data);

/** Returns the refreshed profile, so the caller never has to re-fetch. */
export const driverUploadPhoto = (file) => {
  const form = new FormData();
  form.append("photo", file, file.name || "photo.jpg");
  return postForm("/me/photo", form).then((d) => d.data);
};

export const driverRemovePhoto = () =>
  req("/me/photo", { method: "DELETE" }).then((d) => d.data);

export const driverHistory = (limit = 40) =>
  req(`/history?limit=${limit}`).then((d) => d.data || []);

/** Claims across every trip, with the totals the app leads on. */
export const driverAllExpenses = () =>
  req("/expenses").then((d) => ({ rows: d.data || [], totals: d.totals || {} }));

/**
 * An authenticated image, as an object URL.
 *
 * An <img src> cannot carry an Authorization header, and a driver's photograph
 * is not public, so the bytes are fetched with the token and wrapped instead.
 * The caller owns the returned URL and must revoke it, or every re-render
 * leaks a blob that lives until the tab closes.
 */
export async function driverBlobUrl(path) {
  const auth = getDriverAuth();
  const r = await fetch(BASE + path, {
    headers: auth?.token ? { Authorization: `Bearer ${auth.token}` } : {},
  });
  if (!r.ok) return null;
  return URL.createObjectURL(await r.blob());
}
