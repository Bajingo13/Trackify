import { useSyncExternalStore } from "react";
import { API_ORIGIN } from "../services/apiOrigin";
import { onNativeNetworkChange } from "./native";

/**
 * The driver app's one answer to "is the internet there": online, unstable or
 * offline.
 *
 * navigator.onLine and Android's "connected" only say that the phone has a
 * network. A truck at a fuel station on captive-portal wifi, or a tower with
 * no backhaul, has a network and reaches nothing. So those signals can only
 * ever take the app *down*. Coming back up takes a real answer from the
 * server, either the probe below or any API call that returns.
 *
 *   online    the last probe answered, and quickly
 *   unstable  it answered slowly, the phone reports a 2G-class link, or one
 *             request just failed after a good one
 *   offline   the phone has no network, or two requests in a row failed
 *
 * The probe runs only while something is subscribed (the app is open) and the
 * screen is visible: every 30s while online, and backing off from 5s to 60s
 * while it is not, like the outbox retry in OfflineBar.
 */

export const PROBE_URL = `${API_ORIGIN}/api/health/live`;
const PROBE_TIMEOUT_MS = 5000;
export const SLOW_MS = 2500;
const ONLINE_EVERY_MS = 30000;
const RETRY_INITIAL_MS = 5000;
const RETRY_MAX_MS = 60000;
const FAILS_FOR_OFFLINE = 2;

const osOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/* A 2G-class link, by the phone's own estimate. Chrome and Android's webview only. */
function osSaysSlow() {
  const c = typeof navigator === "undefined" ? null : navigator.connection;
  if (!c) return false;
  return c.effectiveType === "slow-2g" || c.effectiveType === "2g" || (Number(c.rtt) || 0) > 1500;
}

let state = osOnline() ? "online" : "offline";
let fails = 0;
let retryDelay = RETRY_INITIAL_MS;
let timer = null;
let inFlight = null;
let epoch = 0; // bumped by resetNetStatus, so a probe from before it is ignored
let stopInputs = null;
const listeners = new Set();

function set(next) {
  if (next === state) return;
  state = next;
  listeners.forEach((fn) => fn());
  schedule();
}

export const getNetState = () => state;

function visible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function schedule() {
  clearTimeout(timer);
  timer = null;
  if (listeners.size === 0 || !visible()) return;
  const delay = state === "online" ? ONLINE_EVERY_MS : retryDelay;
  timer = setTimeout(() => { void checkNow(); }, delay);
}

/**
 * The probe answered, in `ms`. A link that stays slow is probed less and less
 * often, 5s up to 60s, rather than every 5s for as long as the slow spell lasts:
 * weak links are where battery and data matter most.
 */
function probeAnswered(ms) {
  fails = 0;
  const slow = ms > SLOW_MS || osSaysSlow();
  retryDelay = slow && state === "unstable" ? Math.min(retryDelay * 2, RETRY_MAX_MS) : RETRY_INITIAL_MS;
  set(slow ? "unstable" : "online");
}

/**
 * An API call got an answer, any status. That proves the server is reachable,
 * so the app comes back from offline. It says nothing about speed, though: a
 * receipt photo takes long to upload on any link. Only the probe judges that.
 */
export function reportSuccess() {
  fails = 0;
  retryDelay = RETRY_INITIAL_MS;
  if (state === "offline") set("online");
}

/** A request never reached the server. */
export function reportFailure() {
  fails += 1;
  if (!osOnline() || fails >= FAILS_FOR_OFFLINE) set("offline");
  else if (state === "online") set("unstable");
}

/** The phone itself says there is no network: no need to ask anyone. */
function goOffline() {
  fails = FAILS_FOR_OFFLINE;
  if (state === "offline") schedule(); // set() schedules on a change itself
  else set("offline");
}

/**
 * Ask the server now. Resolves to the state afterwards. Calls made while one
 * is already out share it, so a burst of events costs a single request.
 */
export function checkNow() {
  if (inFlight) return inFlight;
  if (!osOnline()) {
    goOffline();
    return Promise.resolve(state);
  }
  const started = Date.now();
  const ctrl = typeof AbortController === "undefined" ? null : new AbortController();
  const giveUp = ctrl ? setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS) : null;
  const mine = epoch; // a reset in between makes this probe's answer stale
  inFlight = fetch(PROBE_URL, { cache: "no-store", signal: ctrl?.signal })
    .then((r) => {
      if (mine !== epoch) return;
      // Only Trackify answers 204 here. A captive portal's page, a proxy's error
      // or a redirect is a network that reaches something else.
      if (r?.status !== 204) throw new Error(`probe answered ${r?.status}`);
      probeAnswered(Date.now() - started);
    })
    .catch(() => {
      if (mine !== epoch) return;
      reportFailure();
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    })
    .then(() => {
      clearTimeout(giveUp);
      if (mine !== epoch) return state;
      inFlight = null;
      schedule();
      return state;
    });
  return inFlight;
}

function startInputs() {
  if (typeof window === "undefined") return () => {};
  const onOnline = () => { void checkNow(); }; // a hint to look, never proof
  const onVisible = () => (visible() ? void checkNow() : schedule());
  const conn = typeof navigator === "undefined" ? null : navigator.connection;
  const onConn = () => { void checkNow(); };

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", goOffline);
  document.addEventListener("visibilitychange", onVisible);
  conn?.addEventListener?.("change", onConn);
  const offNative = onNativeNetworkChange((connected) => (connected ? void checkNow() : goOffline()));

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", goOffline);
    document.removeEventListener("visibilitychange", onVisible);
    conn?.removeEventListener?.("change", onConn);
    offNative();
  };
}

/** Listen for changes. The first listener starts the probe, the last stops it. */
export function subscribe(fn) {
  listeners.add(fn);
  if (listeners.size === 1) {
    stopInputs = startInputs();
    void checkNow();
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      stopInputs?.();
      stopInputs = null;
      clearTimeout(timer);
      timer = null;
    }
  };
}

/** "online" | "unstable" | "offline", live. */
export function useNetStatus() {
  return useSyncExternalStore(subscribe, getNetState, getNetState);
}

/** Tests only: back to a fresh start. */
export function resetNetStatus(next = osOnline() ? "online" : "offline") {
  epoch += 1;
  clearTimeout(timer);
  timer = null;
  inFlight = null;
  fails = 0;
  retryDelay = RETRY_INITIAL_MS;
  state = next;
}
