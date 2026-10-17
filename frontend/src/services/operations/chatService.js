import { del, get, getDataUrl, post } from "../apiClient";

/**
 * Trip chat, dispatch side. One thread per trip, between the driver on it and
 * the branch running it. New messages also arrive over the realtime socket as
 * `trip:message`; these calls are the load, the send, and the fallback poll.
 */

/** The thread, or only what came after `after` (a message id). */
export async function getThread(tripId, after = 0) {
  const res = await get(`/operations/chat/trips/${tripId}${after ? `?after=${after}` : ""}`);
  return res.data;
}

/** clientRef makes a retried send harmless: the server stores it once. */
export async function sendMessage(tripId, body, clientRef) {
  const res = await post(`/operations/chat/trips/${tripId}`, { body, clientRef });
  return res.data;
}

/** A photo the driver sent, as a data URL. The route is authenticated, so an <img src> cannot fetch it. */
export const getPhoto = (tripId, messageId) =>
  getDataUrl(`/operations/chat/trips/${tripId}/messages/${messageId}/photo`);

/** The proof-of-delivery image used by the automatic completion card. */
export const getCompletionPhoto = (tripId) =>
  getDataUrl(`/operations/trips/${tripId}/pod-photo`);

/** Clears this conversation for the signed-in staff member only. */
export const deleteChat = (tripId) => del(`/operations/chat/trips/${tripId}`);

/*
 * Which conversation is on screen. The top bar pops up a notice when a driver
 * writes; it must not do that for the thread somebody is already reading.
 */
let openTripId = null;
export const setOpenChat = (tripId) => { openTripId = tripId ?? null; };
export const isChatOpen = (tripId) => openTripId != null && openTripId === Number(tripId);

/** Announced on window after a read, so every unread count on screen can refresh at once. */
export const CHAT_READ_EVENT = "trackify:chat-read";

export async function markRead(tripId, lastMessageId) {
  const res = await post(`/operations/chat/trips/${tripId}/read`, { lastMessageId });
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHAT_READ_EVENT));
  return res;
}

/** [{ tripId, ticketNo, unread, lastMessageId }] — driver messages this person has not read. */
export async function getUnread() {
  const res = await get("/operations/chat/unread");
  return res.data || [];
}

export function newClientRef() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
