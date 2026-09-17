/**
 * Realtime channel — a single shared WebSocket to the backend `/ws` hub.
 *
 * Usage (React):
 *   useRealtime((msg) => { ... }, onStatusChange?)
 *
 * Messages are `{ type, ... }`:
 *   trip:location  { tripId, lat, lng, speedKph, heading, recordedAt }
 *   trip:status    { tripId, status, from }
 *
 * The socket connects lazily on the first subscriber and closes when the last
 * one unsubscribes. It reconnects on its own with capped backoff. If the token
 * is missing or the server is down, subscribers simply never receive messages —
 * callers keep their polling fallback.
 */
import { useEffect, useRef } from "react";

import { API_ORIGIN } from "./apiOrigin";
import { post } from "./apiClient";
/**
 * API_ORIGIN is empty when the app is reached from somewhere other than this
 * machine, because the API is then proxied onto the same origin. A socket
 * still needs an absolute address, so build one from the page itself — and
 * use wss when the page is https, or the browser blocks it as mixed content.
 */
const WS_URL = (() => {
  const base =
    API_ORIGIN ||
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:5000");
  return `${base.replace(/^http/i, "ws").replace(/\/+$/, "")}/ws`;
})();

let socket = null;
let reconnectTimer = null;
let ticketRequest = null;
let connectionGeneration = 0;
let backoff = 1000;
let status = "idle"; // idle | connecting | open | closed
const messageListeners = new Set();
const statusListeners = new Set();

function setStatus(next) {
  status = next;
  statusListeners.forEach((fn) => { try { fn(next); } catch { /* ignore */ } });
}

async function connect() {
  if (socket || ticketRequest || !messageListeners.size) return;
  const generation = connectionGeneration;

  setStatus("connecting");
  const request = post("/operations/tracking/realtime-ticket", {});
  ticketRequest = request;
  let response;
  let requestError;
  try {
    response = await request;
  } catch (error) {
    requestError = error;
  } finally {
    if (ticketRequest === request) ticketRequest = null;
  }

  // Unsubscribing invalidates an in-flight ticket. If somebody subscribed again
  // meanwhile, obtain a fresh ticket instead of opening the stale generation.
  if (generation !== connectionGeneration || !messageListeners.size || socket) {
    if (messageListeners.size && !socket && generation !== connectionGeneration) connect();
    return;
  }
  const ticket = response?.data?.ticket;
  if (requestError || typeof ticket !== "string" || !ticket) {
    setStatus("closed");
    scheduleReconnect();
    return;
  }

  const qs = new URLSearchParams({ ticket }).toString();
  let ws;
  try {
    ws = new WebSocket(`${WS_URL}?${qs}`);
  } catch {
    setStatus("closed");
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    if (socket !== ws) return;
    backoff = 1000;
    setStatus("open");
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (!msg || msg.type === "hello") return;
    messageListeners.forEach((fn) => { try { fn(msg); } catch { /* ignore */ } });
  };
  ws.onerror = () => {
    if (socket !== ws) return;
    try { ws.close(); } catch { /* ignore */ }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    setStatus("closed");
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (reconnectTimer || !messageListeners.size) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, backoff);
  backoff = Math.min(backoff * 2, 30000);
}

function teardownIfIdle() {
  if (messageListeners.size) return;
  connectionGeneration++;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (socket) {
    const current = socket;
    socket = null;
    try { current.close(); } catch { /* ignore */ }
  }
  setStatus("idle");
}

export function subscribeRealtime(onMessage, onStatus) {
  messageListeners.add(onMessage);
  if (onStatus) { statusListeners.add(onStatus); onStatus(status); }
  connect();
  return () => {
    messageListeners.delete(onMessage);
    if (onStatus) statusListeners.delete(onStatus);
    teardownIfIdle();
  };
}

/** React hook — `handler` and `onStatus` may change every render; latest is used. */
export function useRealtime(handler, onStatus) {
  const hRef = useRef(handler);
  const sRef = useRef(onStatus);
  hRef.current = handler;
  sRef.current = onStatus;

  useEffect(() => {
    const off = subscribeRealtime(
      (msg) => hRef.current?.(msg),
      (st) => sRef.current?.(st),
    );
    return off;
  }, []);
}
