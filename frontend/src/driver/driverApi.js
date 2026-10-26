import { enqueue, enqueueTrailPoint, flush, isOnline } from "./offlineQueue";
import { newClientRef } from "./supportKinds";
import { reportFailure, reportSuccess } from "./netStatus";
import { rememberEmergencyLine } from "./emergencyLine";

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
 * phone a new one, which then needs the emailed code or the office.
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

/*
 * How long a request may go unanswered before it counts as no signal.
 *
 * A phone on wifi behind a login page, or holding one bar at the edge of
 * coverage, reports itself online and then never hears back: without a limit
 * the screen spins for ever and the outbox never takes the record. A timeout is
 * a transport failure like any other, so trip progress is parked and replayed —
 * which is safe even when the slow request did land, because the server
 * answers a replay of the driver's own step as already done.
 * Uploads get longer, because a photo on a weak signal is slow, not lost, and a
 * receipt scan waits its turn on the server's reader.
 */
export const REQUEST_TIMEOUT_MS = 20000;
export const UPLOAD_TIMEOUT_MS = 90000;
export const SCAN_TIMEOUT_MS = 120000;

/*
 * fetch, telling netStatus whether the server was reached. Any status counts as
 * reached. A request that never got there — no signal, or no answer in time —
 * is marked `transport`, so a caller can tell "no signal" from anything that
 * went wrong after the server answered.
 *
 * The timer races the request as well as aborting it: in the native app
 * CapacitorHttp stands in for fetch and may not honour an AbortSignal.
 */
const reach = (url, init, ms = REQUEST_TIMEOUT_MS) => {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctl?.abort();
      reject(new Error("Trackify took too long to answer. Check your signal and try again."));
    }, ms);
  });
  return Promise.race([fetch(url, ctl ? { ...init, signal: ctl.signal } : init), expired])
    .finally(() => clearTimeout(timer))
    .then(
      (r) => {
        // The API never redirects. One that did came from a captive portal's login
        // page, which is a network that reaches something other than Trackify.
        if (r?.redirected) {
          reportFailure();
          throw Object.assign(new Error("No connection to Trackify."), { transport: true });
        }
        reportSuccess();
        return r;
      },
      (e) => {
        reportFailure();
        const err = e instanceof Error ? e : new Error(String(e?.message || e));
        try { err.transport = true; } catch { throw Object.assign(new Error(err.message), { name: err.name, transport: true }); }
        throw err;
      },
    );
};

/** The request never reached the server (no signal, a timeout, an abort). */
const neverReached = (e) => e?.transport === true;

async function req(path, opts = {}) {
  const auth = getDriverAuth();
  const headers = { "Content-Type": "application/json", ...authHeaders(auth), ...opts.headers };
  const r = await reach(BASE + path, { ...opts, headers });
  let data = {};
  try { data = await r.json(); } catch { /* empty */ }
  if (r.status === 401 && !path.startsWith("/auth")) {
    clearDriverAuth();
    window.location.assign("/driver");
    // carries its status: the server answered, so this is never "you're offline"
    throw Object.assign(new Error("Session expired"), { status: 401, sessionExpired: true });
  }
  if (!r.ok) {
    const e = new Error(data.message || "Something went wrong");
    e.status = r.status;
    e.attemptsLeft = data.attemptsLeft;
    e.expired = data.expired;
    e.retryAfter = data.retryAfter;
    throw e;
  }
  return data;
}

/**
 * { token, driver } on the trusted phone, or on any other phone (and a new
 * account's first) { status: "device_verification_required", pendingToken,
 * locked, firstPhone, emailHint, emailSent, emailError, codeMinutes } — a code
 * has been emailed to the driver, unless emailHint is null (none on file).
 */
export const driverLogin = (employeeNo, pin) =>
  req("/auth/login", { method: "POST", body: JSON.stringify({ employeeNo, pin }) });

/* ---- a new phone ---- */

/** A waiting phone enters the emailed code. { token }. Errors carry attemptsLeft, and expired when a new code is needed. */
export const driverVerifyDevice = (pendingToken, code) =>
  req("/auth/device/verify", { method: "POST", body: JSON.stringify({ pendingToken, code }) })
    .then((d) => d.data);

/** Email another code; the last one stops working. Errors carry retryAfter (seconds). */
export const driverResendCode = (pendingToken) =>
  req("/auth/device/resend", { method: "POST", body: JSON.stringify({ pendingToken }) }).then((d) => d.data);

/** Change this driver's PIN; the current one is asked again. Wrong current PIN: 403. { emailed }. */
export const driverChangePin = (currentPin, newPin) =>
  req("/pin", { method: "POST", body: JSON.stringify({ currentPin, newPin }) }).then((d) => d.data);

/** No access to the email: ask the office to approve this phone. */
export const driverAskOffice = (pendingToken) =>
  req("/auth/device/ask-office", { method: "POST", body: JSON.stringify({ pendingToken }) });

/** Has the office approved this phone? { status: "waiting" | "approved" | "refused", token? }. */
export const driverDeviceStatus = (pendingToken) =>
  req("/auth/device/status", { method: "POST", body: JSON.stringify({ pendingToken }) }).then((d) => d.data);
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
/** The route driven on a finished run: { points, snapped, distanceKm, startedAt, endedAt }. */
export const driverTripTrail = (id) => req(`/trips/${id}/trail`).then((d) => d.data);
/*
 * What goes to the office for an answer: a request, a message, a pause, a
 * claim. These need a live connection and are never parked. Saved for later,
 * they would sit on the phone while the driver believed the office had them.
 * Only the run's own progress (start, stops, delivery, GPS) is kept through a
 * dead zone, so the route can be driven and finished without signal.
 * Rows of these kinds saved by an older build still replay; nothing is dropped.
 */
export const ONLINE_ONLY = new Set(["support", "support-reply", "message", "photo", "pause", "expense"]);

export const NEEDS_INTERNET =
  "You're offline. This needs an internet connection. Try again when the No Connection sign is gone.";
const needsInternet = () => Object.assign(new Error(NEEDS_INTERNET), { offline: true });

/**
 * Anything the driver files from the road goes through here. Trip progress out
 * of coverage is parked in the outbox and replayed later, so a dead zone never
 * silently swallows a delivery. ONLINE_ONLY kinds fail with `offline` set
 * instead.
 */
async function sendOrQueue(kind, path, { json, form, wire, onPark } = {}) {
  const ownerId = currentDriverId();
  if (!ownerId) throw new Error("Driver sign-in required.");
  if (ONLINE_ONLY.has(kind)) {
    if (!isOnline()) throw needsInternet();
    try {
      return json
        ? await req(path, { method: "POST", body: JSON.stringify(json) })
        : await postForm(path, form);
    } catch (e) {
      // never reached the server: say so, and leave the form as it was
      if (neverReached(e)) throw needsInternet();
      throw e;
    }
  }
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
    // anything else worth keeping about it (a GPS reading's trail copy); never fails the save
    try { await onPark?.(); } catch { /* the saved record is what matters */ }
    return { queued: true };
  };

  if (!isOnline()) {
    return park();
  }
  try {
    return json
      ? await req(path, { method: "POST", body: JSON.stringify(wire ? wire(json) : json) })
      : await postForm(path, form);
  } catch (e) {
    // a transport failure means it never reached the server — keep it
    if (neverReached(e)) {
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

async function postForm(path, form, ms = UPLOAD_TIMEOUT_MS) {
  const auth = getDriverAuth();
  const r = await reach(BASE + path, {
    method: "POST",
    headers: authHeaders(auth),
    body: form,
  }, ms);
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
    // GPS readings go with their age, so they keep the time they were taken
    const json = row.kind === "ping" ? readingOnWire(row.json, row.queuedAt)
      : row.kind === "trail" ? { points: (row.json?.points || []).map((p) => readingOnWire(p)) }
        : row.json || {};
    return req(row.path, { method: "POST", body: JSON.stringify(json) });
  }, ownerId);
};

/*
 * A GPS reading as it goes over the wire: its age instead of its capture time.
 * Both ends of the difference are this phone's clock, so a phone set to the
 * wrong time still lands the point where the truck was (trackingPoints.js on
 * the server). A row saved before readings carried a capture time uses the
 * moment it was saved.
 */
function readingOnWire({ capturedAt, ...rest } = {}, savedAt) {
  const at = Number.isFinite(capturedAt) ? capturedAt : savedAt;
  return Number.isFinite(at) ? { ...rest, ageMs: Math.max(0, Date.now() - at) } : rest;
}

/**
 * One GPS reading for this trip. It gets its own name and capture time here,
 * once, so a replay and the trail copy of it are recognisably the same
 * reading. If it cannot be sent, it is saved as a live ping (dispatch's view
 * of the truck, for a few minutes) and, one a minute, for the trail.
 */
export const driverPing = (id, body) => {
  const fix = { ...body, clientRef: body?.clientRef || newClientRef(), capturedAt: body?.capturedAt ?? Date.now() };
  return sendOrQueue("ping", `/trips/${id}/ping`, {
    json: fix,
    wire: (json) => readingOnWire(json),
    onPark: () => enqueueTrailPoint(currentDriverId(), id, fix),
  });
};
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
 * File a request. Needs a connection (ONLINE_ONLY): out of signal it fails with
 * `offline` set and the form keeps what was typed. clientRef is chosen here so
 * an older build's saved copy, replayed, files it once, not twice.
 */
export const driverSupportCreate = (body) => sendOrQueue("support", "/support", { json: body });

/** Write on a request already filed. Needs a connection, like filing it. */
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
 * Needs a connection (ONLINE_ONLY): out of signal it fails with `offline` set,
 * and the driver calls the office instead. clientRef makes a retry after a lost
 * reply file it once, not twice.
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
 * Needs a connection (ONLINE_ONLY). clientRef is chosen here so a retry after a
 * lost reply is stored once, not twice.
 */
export const driverSendMessage = (tripId, body, clientRef) =>
  sendOrQueue("message", `/trips/${tripId}/messages`, { json: { body, clientRef } });

/**
 * A photo for dispatch, with optional words. Needs a connection (ONLINE_ONLY).
 * clientRef makes a retry store it once.
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

/** multipart: the browser sets its own boundary, so no Content-Type here. Needs a connection (ONLINE_ONLY). */
export async function driverSubmitExpense(tripId, form) {
  const out = await sendOrQueue("expense", `/trips/${tripId}/expenses`, { form });
  return out?.data;
}

/**
 * Read a receipt photo into a claim: { status, message?, fields?, confidence? }.
 * Never queued. A reading only fills in the form, so without signal the driver
 * types the claim in and the photo goes with it as usual. A transport failure
 * comes back as an error with `offline` set.
 */
export async function driverScanReceipt(file) {
  const offline = () => Object.assign(new Error("No signal, so the receipt cannot be read right now. Fill in the claim by hand. The photo will still be attached."), { offline: true });
  if (!isOnline()) throw offline();
  const form = new FormData();
  form.append("receipt", file, file.name || "receipt.jpg");
  try {
    return (await postForm("/receipts/scan", form, SCAN_TIMEOUT_MS)).data;
  } catch (e) {
    if (neverReached(e)) throw offline();
    throw e;
  }
}

/* ---- the driver's own account ---- */

export const driverMe = () => req("/me").then((d) => {
  // kept on the phone for the Emergency screen, which has to work without signal
  if (d.data?.emergencyLine) rememberEmergencyLine(currentDriverId(), d.data.emergencyLine);
  return d.data;
});

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
