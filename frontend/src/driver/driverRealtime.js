/**
 * The Driver App's live line to the office.
 *
 * One WebSocket to the backend's /ws hub, opened with a one-minute driver
 * ticket. It carries only this driver's own events:
 *
 *   { type: "chat:message", channel: "trip", tripId, ticketNo, from, preview, messageId }
 *   { type: "chat:message", channel: "support", ticketId, ticketNo, from, preview, messageId }
 *   { type: "trip:pause", tripId, status }
 *
 * so the bell, an open chat and the run card change the moment dispatch acts,
 * not at the next poll. The polls stay: a phone in a tunnel, a server restart or
 * a dropped socket only ever makes things slower, never wrong.
 *
 * Connects on the first subscriber, closes after the last; reconnects with
 * capped back-off, and at once when the app comes back to the foreground or the
 * phone back online (a phone suspends sockets in the background).
 */
import { useEffect, useRef } from "react";
import { API_ORIGIN } from "../services/apiOrigin";
import { driverRealtimeTicket, getDriverAuth } from "./driverApi";

const WS_URL = (() => {
  const base = API_ORIGIN || (typeof window !== "undefined" ? window.location.origin : "http://localhost:5000");
  return `${base.replace(/^http/i, "ws").replace(/\/+$/, "")}/ws`;
})();

const MAX_BACKOFF = 30000;
const listeners = new Set();
let socket = null;
let connecting = false;
let timer = null;
let backoff = 1000;
let generation = 0;

function schedule() {
  if (timer || !listeners.size) return;
  timer = setTimeout(() => { timer = null; void connect(); }, backoff);
  backoff = Math.min(backoff * 2, MAX_BACKOFF);
}

/** Signed in? Anything that cannot say (no storage, a test double) counts as no. */
function signedIn() {
  try { return Boolean(getDriverAuth()?.token); } catch { return false; }
}

async function connect() {
  if (socket || connecting || !listeners.size || !signedIn()) return;
  if (typeof WebSocket === "undefined") return;
  connecting = true;
  const mine = generation;
  let ticket;
  try {
    ticket = await driverRealtimeTicket();
  } catch {
    connecting = false;
    schedule();
    return;
  }
  connecting = false;
  if (mine !== generation || !listeners.size) return;

  const ws = new WebSocket(`${WS_URL}?ticket=${encodeURIComponent(ticket)}`);
  socket = ws;
  ws.onopen = () => { backoff = 1000; };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (!msg || msg.type === "hello") return;
    listeners.forEach((fn) => { try { fn(msg); } catch { /* one listener cannot stop the rest */ } });
  };
  ws.onclose = (e) => {
    if (socket === ws) socket = null;
    // 4003: not permitted (signed out, app access withdrawn) — stop until asked again
    if (e?.code === 4003) return;
    schedule();
  };
  ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
}

function disconnect() {
  generation += 1;
  clearTimeout(timer);
  timer = null;
  backoff = 1000;
  const ws = socket;
  socket = null;
  if (ws) { try { ws.close(1000, "done"); } catch { /* ignore */ } }
}

/** Back to the foreground, or back online: reconnect now rather than after the back-off. */
function wake() {
  if (!listeners.size) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  clearTimeout(timer);
  timer = null;
  backoff = 1000;
  void connect();
}
if (typeof window !== "undefined") {
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);
}

export function subscribeDriverRealtime(fn) {
  listeners.add(fn);
  void connect();
  return () => {
    listeners.delete(fn);
    if (!listeners.size) disconnect();
  };
}

/** Sign-out: drop the connection, whatever is listening. */
export function closeDriverRealtime() { disconnect(); }

/**
 * React: `useDriverRealtime((msg) => ...)`. The latest handler is always the
 * one called, so it may close over fresh state without reconnecting.
 */
export function useDriverRealtime(handler, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeDriverRealtime((msg) => ref.current?.(msg));
  }, [enabled]);
}
