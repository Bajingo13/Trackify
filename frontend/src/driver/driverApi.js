import { enqueue, flush, isOnline } from "./offlineQueue";

import { API_ORIGIN } from "../services/apiOrigin";

const BASE = `${API_ORIGIN}/api/v1/driver`;
const KEY = "ttms_driver_auth";

export const getDriverAuth = () => {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
};
export const setDriverAuth = (a) => localStorage.setItem(KEY, JSON.stringify(a));
export const clearDriverAuth = () => localStorage.removeItem(KEY);
export const currentDriverId = () => {
  const id = Number(getDriverAuth()?.driver?.driverId);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/*
 * This phone's own key. Made once, the first time the app opens, and kept
 * through sign-outs: it is how the server tells the driver's trusted phone from
 * any other (backend devices.service.js). Clearing the app's data makes the
 * phone a new one, which then needs a recovery code or the office.
 */
const DEVICE_KEY = "ttms_driver_device";
let memoryDeviceKey = null;
export function deviceKey() {
  try {
    const kept = localStorage.getItem(DEVICE_KEY);
    if (kept && /^[A-Za-z0-9_-]{32,128}$/.test(kept)) return kept;
  } catch { /* storage blocked: fall through to a key for this session */ }
  if (!memoryDeviceKey) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    memoryDeviceKey = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  try { localStorage.setItem(DEVICE_KEY, memoryDeviceKey); } catch { /* ignore */ }
  return memoryDeviceKey;
}

/** The session and the phone it belongs to: a token is refused from any other phone. */
function authHeaders(auth) {
  const headers = { "X-Driver-Device": deviceKey() };
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  return headers;
}

async function req(path, opts = {}) {
  const auth = getDriverAuth();
  const headers = { "Content-Type": "application/json", ...authHeaders(auth), ...opts.headers };
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
    e.attemptsLeft = data.attemptsLeft;
    throw e;
  }
  return data;
}

/**
 * { token, driver, recoveryCodes? } on the trusted phone (recoveryCodes only the
 * first time, to be written down), or { status: "device_verification_required",
 * pendingToken, locked } on any other phone.
 */
export const driverLogin = (employeeNo, pin) =>
  req("/auth/login", { method: "POST", body: JSON.stringify({ employeeNo, pin }) });

/* ---- a new phone ---- */

/** A waiting phone enters a recovery code. { token, codesLeft, lowCodes }. Errors carry attemptsLeft. */
export const driverVerifyDevice = (pendingToken, recoveryCode) =>
  req("/auth/device/verify", { method: "POST", body: JSON.stringify({ pendingToken, recoveryCode }) })
    .then((d) => d.data);

/** Has the office approved this phone? { status: "waiting" | "approved" | "refused", token? }. */
export const driverDeviceStatus = (pendingToken) =>
  req("/auth/device/status", { method: "POST", body: JSON.stringify({ pendingToken }) }).then((d) => d.data);

/** How many recovery codes are left: { codesLeft, lowCodes }. */
export const driverRecoveryCodesLeft = () => req("/recovery-codes").then((d) => d.data);

/** A new set of codes, replacing the old. The PIN is asked again. { recoveryCodes }. */
export const driverNewRecoveryCodes = (pin) =>
  req("/recovery-codes", { method: "POST", body: JSON.stringify({ pin }) }).then((d) => d.data);
/**
 * The Terms of Service, and whether this driver has accepted the version that
 * is published now. Both in one response so the gate can decide before the app
 * renders anything.
 */
export const driverAgreement = () => req("/agreement").then((d) => d.data);
/* The version accepted is decided by the server, so nothing is sent. */
export const driverAcceptAgreement = () =>
  req("/agreement/accept", { method: "POST" }).then((d) => d.data);
export const driverTrips = () => req("/trips").then((d) => d.data || []);
export const driverTrip = (id) => req(`/trips/${id}`).then((d) => d.data);
/**
 * Anything the driver files from the road goes through here. Out of coverage
 * it is parked in the outbox and replayed later, so a dead zone never silently
 * swallows a delivery or an expense.
 */
async function sendOrQueue(kind, path, { json, form } = {}) {
  const ownerId = currentDriverId();
  if (!ownerId) throw new Error("Driver sign-in required.");
  const park = async () => {
    const saved = await enqueue({
      ownerId,
      kind,
      path,
      json: json || null,
      form: form ? await formToParts(form) : null,
    });
    if (!saved) {
      throw new Error("Could not send or save this update on the phone. Keep this screen open and try again.");
    }
    return { queued: true };
  };

  if (!isOnline()) {
    return park();
  }
  try {
    return json
      ? await req(path, { method: "POST", body: JSON.stringify(json) })
      : await postForm(path, form);
  } catch (e) {
    // a transport failure means it never reached the server — keep it
    if (e.status == null) {
      return park();
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
    headers: authHeaders(auth),
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
export const flushOutbox = () => {
  const ownerId = currentDriverId();
  if (!ownerId) return Promise.resolve({ sent: 0, dropped: 0 });
  return flush(async (row) => {
    // A sign-out or account switch while replay is running must never send the
    // previous driver's saved record with the new driver's bearer token.
    if (currentDriverId() !== ownerId) {
      throw new Error("Driver changed while saved work was being sent.");
    }
    if (row.form) return postForm(row.path, partsToForm(row.form));
    return req(row.path, { method: "POST", body: JSON.stringify(row.json || {}) });
  }, ownerId);
};

export const driverPing = (id, body) => sendOrQueue("ping", `/trips/${id}/ping`, { json: body });
export const driverStart = (id) => sendOrQueue("start", `/trips/${id}/start`, { json: {} });

/** Reached a waypoint. Queued when offline, like every other filed record. */
export const driverArriveAtStop = (tripId, stopId, body) =>
  sendOrQueue("stop", `/trips/${tripId}/stops/${stopId}/arrive`, { json: body || {} });

/** Proof of delivery: who received it, where the driver was, and a photo. */
export const driverDeliver = (id, form) => sendOrQueue("deliver", `/trips/${id}/deliver`, { form });

/* ---- Help & Support: concerns and requests for the office ---- */

/** The driver's own requests, newest activity first. Each says whether an answer is unread. */
export const driverSupportList = () => req("/support").then((d) => d.data || []);

/** How many requests have an answer the driver has not read — the dot on the help button. */
export const driverSupportUnread = () => req("/support/unread").then((d) => d.data?.unread || 0);

/**
 * The same, with the requests behind the count: { unread, tickets: [{ id,
 * ticketNo, subject, tripNo, unread, preview, lastAt }] }, newest answer first.
 * The notification bell lists these, so an office reply is seen from any tab.
 */
export const driverSupportUnreadSummary = () => req("/support/unread")
  .then((d) => ({ unread: d.data?.unread || 0, tickets: d.data?.tickets || [] }));

/** One request with its whole thread. Reading it marks the answers read. */
export const driverSupportGet = (id) => req(`/support/${id}`).then((d) => d.data);

/**
 * File a request. Sent now, or parked in the outbox out of signal — a problem
 * on the road is exactly when there may be none. clientRef is chosen here so a
 * replay after a lost reply files it once, not twice.
 */
export const driverSupportCreate = (body) => sendOrQueue("support", "/support", { json: body });

/** Write on a request already filed. Same outbox, same replay protection. */
export const driverSupportReply = (id, body, clientRef) =>
  sendOrQueue("support-reply", `/support/${id}/messages`, { json: { body, clientRef } });

/**
 * Reopen a request that was resolved or closed. Needs an answer at once (the server may
 * say no: too old, or a pause request), so it is not parked in the outbox.
 */
export const driverSupportReopen = (id) => req(`/support/${id}/reopen`, { method: "POST", body: "{}" }).then((d) => d.data);

/* ---- notifications on this phone ---- */

/** { enabled, publicKey }: whether the server can send notices, and the key a phone needs to ask for them. */
export const driverPushKey = () => req("/push/key").then((d) => d.data);
export const driverPushSubscribe = (subscription) =>
  req("/push/subscribe", { method: "POST", body: JSON.stringify({ subscription }) }).then((d) => d.data);
export const driverPushUnsubscribe = (endpoint) =>
  req("/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }).then((d) => d.data);

/* ---- pause requests: holding a delivery for a real interruption ---- */

/**
 * Ask the office to pause a delivery, with a reason, a description and photographs.
 *
 * Sent now, or parked in the outbox out of signal — a breakdown on a mountain
 * road is exactly when there is none, and the photographs travel with it.
 * clientRef makes a replay after a lost reply file it once, not twice.
 */
export function driverPauseCreate(tripId, { reason, description, photos = [], lat, lng, clientRef }) {
  const form = new FormData();
  form.append("reason", reason);
  form.append("description", description);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    form.append("lat", String(lat));
    form.append("lng", String(lng));
  }
  form.append("clientRef", clientRef);
  // when the driver pressed Send: a request parked out of signal keeps this time
  form.append("requestedAt", new Date().toISOString());
  for (const file of photos) form.append("photos", file, file.name || "photo.jpg");
  return sendOrQueue("pause", `/trips/${tripId}/pause`, { form });
}

/** The pause on a trip that is waiting or in force, or null. */
export const driverPauseActive = (tripId) => req(`/trips/${tripId}/pause`).then((d) => d.data?.active || null);

/** Withdraw a request nobody has answered. */
export const driverPauseWithdraw = (tripId) =>
  req(`/trips/${tripId}/pause/withdraw`, { method: "POST", body: "{}" }).then((d) => d.data);

/** Back on the road: end a pause the office approved. */
export const driverPauseResume = (tripId) =>
  req(`/trips/${tripId}/pause/resume`, { method: "POST", body: "{}" }).then((d) => d.data);

/** Every pause this driver has asked for, newest first — the history. */
export const driverPauseHistory = () => req("/pauses").then((d) => d.data || []);

/** A photograph on one of the driver's own pauses, as a data URL. */
export async function driverPausePhoto(pauseId, photoId) {
  const auth = getDriverAuth();
  const r = await fetch(`${BASE}/pauses/${pauseId}/photos/${photoId}`, {
    headers: authHeaders(auth),
  });
  if (!r.ok) throw new Error("Could not load that photo.");
  const blob = await r.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that photo."));
    reader.readAsDataURL(blob);
  });
}

/* ---- chat with dispatch about a trip ---- */

/** { messages, closed }. `after` (a message id) fetches only what is new. */
export const driverMessages = (tripId, after = 0) =>
  req(`/trips/${tripId}/messages${after ? `?after=${after}` : ""}`).then((d) => d.data);

/**
 * Sent now, or parked in the outbox out of signal. clientRef is chosen here so
 * a replay after a lost reply is stored once, not twice.
 */
export const driverSendMessage = (tripId, body, clientRef) =>
  sendOrQueue("message", `/trips/${tripId}/messages`, { json: { body, clientRef } });

/**
 * A photo for dispatch, with optional words. Sent now, or parked in the outbox
 * out of signal like a delivery or an expense — a photo taken in a dead zone is
 * exactly the one worth keeping. clientRef makes a replay store it once.
 */
export function driverSendPhoto(tripId, file, caption, clientRef) {
  const form = new FormData();
  form.append("photo", file, file.name || "photo.jpg");
  if (caption) form.append("body", caption);
  form.append("clientRef", clientRef);
  return sendOrQueue("photo", `/trips/${tripId}/messages/photo`, { form });
}

/** A photo from the thread, as a data URL. Rejects when it cannot be fetched. */
export async function driverChatPhoto(tripId, messageId) {
  const auth = getDriverAuth();
  const r = await fetch(`${BASE}/trips/${tripId}/messages/${messageId}/photo`, {
    headers: authHeaders(auth),
  });
  if (!r.ok) throw new Error("Could not load that photo.");
  const blob = await r.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that photo."));
    reader.readAsDataURL(blob);
  });
}

/** The POD image shown in the automatic completed-trip card. */
export async function driverPodPhoto(tripId) {
  const auth = getDriverAuth();
  const r = await fetch(`${BASE}/trips/${tripId}/pod-photo`, {
    headers: authHeaders(auth),
  });
  if (!r.ok) throw new Error("Could not load the delivery photo.");
  const blob = await r.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the delivery photo."));
    reader.readAsDataURL(blob);
  });
}

/** Clears this trip conversation for the signed-in driver only. */
export const driverDeleteChat = (tripId) =>
  req(`/trips/${tripId}/messages`, { method: "DELETE" });

export const driverMarkRead = (tripId, lastMessageId) =>
  req(`/trips/${tripId}/messages/read`, { method: "POST", body: JSON.stringify({ lastMessageId }) });

/** [{ tripId, unread }] — dispatch messages not yet read, across this driver's trips. */
export const driverUnread = () => req("/messages/unread").then((d) => d.data || []);

/** A one-minute ticket for the live socket (driverRealtime.js). */
export const driverRealtimeTicket = () => req("/realtime-ticket").then((d) => d.data.ticket);

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

/** Only the fields a driver owns: phone and emergency contact. The licence is the office's, and view-only here. */
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

/*
 * There is no way to add, scan or change a licence from the app: it is the
 * office's record. The licence arrives with driverMe(), and its photo is read
 * with driverBlobUrl("/me/license-photo") — view only.
 */

/*
 * There is no way to add, scan or change a licence from the app: it is the
 * office's record. The licence arrives with driverMe(), and its photo is read
 * with driverBlobUrl("/me/license-photo") — view only.
 */

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
/**
 * The company's photograph for a kind of vehicle, as a data URL.
 *
 * A data URL rather than an object URL because these are cached for the life
 * of the session and shared between screens — there is no single owner to
 * revoke one, and revoking it out from under a screen still using it is worse
 * than the memory it saves.
 *
 * null when the company has not supplied one, which is the common case: the
 * caller falls back to the photograph bundled with the app.
 */
export async function driverTypePhoto(vehicleType) {
  const auth = getDriverAuth();
  const path = `/vehicle-types/${encodeURIComponent(vehicleType)}/photo`;
  const r = await fetch(BASE + path, {
    headers: authHeaders(auth),
  });
  if (!r.ok) return null;
  const blob = await r.blob();
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

export async function driverBlobUrl(path) {
  const auth = getDriverAuth();
  const r = await fetch(BASE + path, {
    headers: authHeaders(auth),
  });
  if (!r.ok) return null;
  return URL.createObjectURL(await r.blob());
}
