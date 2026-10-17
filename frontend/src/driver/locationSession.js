/**
 * Location sharing for the whole app, not one screen.
 *
 * Sharing used to live inside the trip screen and stopped when it closed — so a
 * driver who turned it on, went back to the trip list and came back found it
 * off, and dispatch had lost the truck in between. It now runs here, for as
 * long as the app does, and ends only when:
 *
 *   • the driver turns it off, or signs out
 *   • the trip is over (delivered, cancelled, no longer theirs)
 *   • the phone will not give a position (permission refused or taken away)
 *
 * It is remembered on the phone, per driver, so an app that was closed during a
 * trip picks it up again when reopened — without asking for permission: a
 * resume nobody pressed anything for must never pop a dialog. Without
 * permission it stays off and says why.
 *
 * One session at a time — a driver drives one truck.
 */
import { useEffect, useState } from "react";
import { currentDriverId, driverPing, driverTrip } from "./driverApi";
import { PERMISSION_OFF, startTracking, stopTracking, tracksInBackground } from "./tracking";
import { canShareLocation, isInsecureLan } from "./capabilities";

export const PING_EVERY_MS = 20000;
export const HEARTBEAT_EVERY_MS = 5 * 60 * 1000;
const HEARTBEAT_CHECK_MS = 60 * 1000;
// Dispatch can close or cancel a trip while the driver is elsewhere in the app.
// A 409 on the next ping catches it too; this covers a truck parked long enough
// that no ping is due.
export const STATUS_CHECK_MS = 60 * 1000;
const LIVE = ["released", "in_transit"];

export const RESUME_NEEDS_TAP =
  "Location sharing was paused when the app closed. Turn it on again to keep sharing your position.";

const EMPTY = {
  tripId: null,
  sharing: false,
  starting: false,
  position: null,
  lastSent: null,
  // positions handed to driverPing so far: the screen re-reads the outbox when it moves
  pings: 0,
  error: "",
  canOpenSettings: false,
};

let state = { ...EMPTY };
const listeners = new Set();
// Bumped by every start and stop: a callback from a session that has since
// ended sees the change and does nothing.
let generation = 0;
let lastSentAt = 0;
let lastFix = null;
let heartbeatTimer = null;
let statusTimer = null;
let resumedFor = null;

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => { try { fn(state); } catch { /* one listener cannot stop the rest */ } });
}

export const getLocationSession = () => state;

export function subscribeLocationSession(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React: the session as it stands, re-rendering when it changes. */
export function useLocationSession() {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    setCurrent(state);
    return subscribeLocationSession(setCurrent);
  }, []);
  return current;
}

/* ---- remembered on the phone, per driver ---- */

const KEY = (driverId) => `trackify-driver-sharing:${driverId}`;

function remember(tripId) {
  const driverId = currentDriverId();
  if (!driverId) return;
  try { localStorage.setItem(KEY(driverId), JSON.stringify({ tripId })); } catch { /* sharing still runs, only not resumed */ }
}

function forget() {
  const driverId = currentDriverId();
  if (!driverId) return;
  try { localStorage.removeItem(KEY(driverId)); } catch { /* nothing to clear */ }
}

/*
 * Stopped by a refused permission: the reason is kept in place of the trip, so
 * a driver who was not looking when it happened (the app in the background, a
 * permission changed in Settings) is told on the next open instead of finding
 * sharing silently off.
 */
function rememberStop(tripId, reason) {
  const driverId = currentDriverId();
  if (!driverId) return;
  try { localStorage.setItem(KEY(driverId), JSON.stringify({ tripId, stopped: reason })); } catch { /* told now, if not later */ }
}

/** { tripId, stopped? } or null. */
function remembered() {
  const driverId = currentDriverId();
  if (!driverId) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY(driverId)) || "null");
    const id = Number(saved?.tripId);
    if (!Number.isInteger(id) || id <= 0) return null;
    return { tripId: id, stopped: typeof saved.stopped === "string" ? saved.stopped : null };
  } catch {
    return null;
  }
}

/* ---- the session ---- */

function clearTimers() {
  window.clearInterval(heartbeatTimer);
  window.clearInterval(statusTimer);
  heartbeatTimer = null;
  statusTimer = null;
}

/**
 * The session ends on its own (trip over, permission gone). What it said stays
 * on screen; `keepReason` also keeps it for the next open (see rememberStop).
 */
function end(mine, { keepReason = false } = {}) {
  if (mine !== generation) return;
  generation += 1;
  clearTimers();
  lastFix = null;
  stopTracking();
  if (keepReason && state.tripId) rememberStop(state.tripId, state.error);
  else forget();
  set({ sharing: false, starting: false });
}

/**
 * Start sharing for a trip. `prompt: false` for a resume: no permission dialog,
 * and without permission it stays off and says why.
 * @returns true when sharing started
 */
export async function startSharing(tripId, { prompt = true } = {}) {
  const id = Number(tripId);
  // On the web this still needs an https origin; the native app is always a
  // secure context, so the check only bites in a browser.
  if (!tracksInBackground() && !canShareLocation()) {
    set({
      ...EMPTY,
      tripId: id,
      error: isInsecureLan()
        ? "Location sharing needs a secure (https) address. Opened over http from another device, the browser blocks it."
        : "This device can't share GPS location.",
    });
    return false;
  }

  generation += 1;
  const mine = generation;
  clearTimers();
  lastSentAt = 0;
  lastFix = null;
  set({ ...EMPTY, tripId: id, starting: true });

  const submitFix = async (fix) => {
    const now = Date.now();
    if (now - lastSentAt < PING_EVERY_MS) return;
    lastSentAt = now;
    try {
      const result = await driverPing(id, fix);
      if (mine !== generation) return;
      // saved for later is counted by the screen, off the outbox itself
      set({ pings: state.pings + 1, ...(result?.queued ? {} : { lastSent: new Date() }) });
    } catch (e) {
      if (mine !== generation) return;
      set({ error: e.message });
      // 409 means the trip is no longer one this driver can ping.
      if (e.status === 409) end(mine);
    }
  };

  const started = await startTracking(
    (fix) => {
      if (mine !== generation) return;
      // The plugin may hold callbacks back while the truck is parked; the last
      // fix is kept so the heartbeat can keep dispatch's "online" honest.
      lastFix = fix;
      set({ position: { lat: fix.lat, lng: fix.lng } });
      void submitFix(fix);
    },
    // Not every message is a reason to stop. A GPS timeout under a flyover is
    // ordinary, and a background plugin that would not start still leaves the
    // foreground watcher running.
    (message, { fatal = true, canOpenSettings = false } = {}) => {
      if (mine !== generation) return;
      set({ error: message, canOpenSettings });
      if (fatal) end(mine, { keepReason: true });
    },
    { requestPermissions: prompt },
  );

  if (mine !== generation) return false; // stopped, or ended, while starting
  if (!started) {
    set({ starting: false });
    return false;
  }

  set({ sharing: true, starting: false });
  remember(id);

  heartbeatTimer = window.setInterval(() => {
    if (lastFix && Date.now() - lastSentAt >= HEARTBEAT_EVERY_MS) void submitFix(lastFix);
  }, HEARTBEAT_CHECK_MS);
  statusTimer = window.setInterval(() => {
    driverTrip(id)
      .then((trip) => noteTripStatus(id, trip?.status))
      .catch((e) => { if (e?.status === 404) end(mine); /* offline: the next ping will tell */ });
  }, STATUS_CHECK_MS);
  return true;
}

/** The driver turned it off, or signed out. Clears everything, the message included. */
export function stopSharing() {
  generation += 1;
  clearTimers();
  lastFix = null;
  stopTracking();
  forget();
  set({ ...EMPTY });
}

/** A screen read the trip: if it is over, sharing for it ends now rather than at the next check. */
export function noteTripStatus(tripId, status) {
  if (!status || state.tripId !== Number(tripId) || !(state.sharing || state.starting)) return;
  if (!LIVE.includes(status)) end(generation);
}

/* ---- picking up again after the app was closed ---- */

/** "granted" | "denied" | "prompt" | null when the browser cannot say. */
async function geolocationPermission() {
  try {
    const result = await navigator.permissions?.query?.({ name: "geolocation" });
    return result?.state || null;
  } catch {
    return null;
  }
}

/**
 * Called once when the app opens, after the Agreement. Resumes the trip this
 * driver was sharing when the app last closed — never with a permission dialog.
 */
export async function resumeSharing() {
  const driverId = currentDriverId();
  if (!driverId || resumedFor === driverId) return false;
  resumedFor = driverId;
  if (state.sharing || state.starting) return false;
  const saved = remembered();
  if (!saved) return false;
  const { tripId } = saved;

  // It stopped for a reason the driver may not have seen: say it now, once.
  if (saved.stopped) {
    forget();
    // the way to Settings exists only in the installed app
    set({ ...EMPTY, tripId, error: saved.stopped, canOpenSettings: tracksInBackground() });
    return false;
  }

  // A trip that ended while the app was closed is not resumed.
  try {
    const trip = await driverTrip(tripId);
    if (!LIVE.includes(trip?.status)) { forget(); return false; }
  } catch (e) {
    if (e?.status === 404) { forget(); return false; }
    // no signal: resume anyway; pings are saved and the server decides later
  }

  // The native plugin is asked without prompting (tracking.js). A browser has
  // no such switch — starting would prompt — so it resumes only on a grant.
  if (!tracksInBackground()) {
    const permission = await geolocationPermission();
    if (permission !== "granted") {
      forget();
      set({ ...EMPTY, tripId, error: permission === "denied" ? PERMISSION_OFF : RESUME_NEEDS_TAP });
      return false;
    }
  }
  return startSharing(tripId, { prompt: false });
}

/** Tests only: a fresh module state. */
export function resetLocationSessionForTests() {
  generation += 1;
  clearTimers();
  lastSentAt = 0;
  lastFix = null;
  resumedFor = null;
  state = { ...EMPTY };
}
