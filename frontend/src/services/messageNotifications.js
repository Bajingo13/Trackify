/**
 * Drivers' unread messages, for the console's notification bell.
 *
 * Two kinds: what a driver wrote in a run's chat (read with tracking.read) and
 * what a driver wrote on a Help & Support request (support.read — answered from
 * the Exceptions board). Both counts come from the server, which keeps them
 * until the conversation is opened; they are re-read the moment a driver
 * writes (realtime), the moment the conversation is read anywhere in the
 * console, and on a slow poll for a socket that is down.
 */
import { useCallback, useEffect, useState } from "react";
import { get } from "./apiClient";
import { useRealtime } from "./realtime";
import { CHAT_READ_EVENT, getUnread } from "./operations/chatService";

/** Fired when a driver's Help & Support thread has been opened (and so read). */
export const SUPPORT_READ_EVENT = "trackify:support-read";

export async function getDriverSupportUnread() {
  const res = await get("/operations/exceptions/driver-messages");
  return res.data || [];
}

const POLL_MS = 60000;

export function useMessageNotifications(can) {
  const canChat = Boolean(can?.("tracking.read"));
  const canSupport = Boolean(can?.("support.read"));
  const [chats, setChats] = useState([]);
  const [support, setSupport] = useState([]);
  // bumps when a driver writes, so the bell can ring once
  const [arrived, setArrived] = useState(0);

  const loadChats = useCallback(() => {
    if (!canChat) return Promise.resolve();
    return getUnread().then(setChats).catch(() => { /* keep the last count */ });
  }, [canChat]);
  const loadSupport = useCallback(() => {
    if (!canSupport) return Promise.resolve();
    return getDriverSupportUnread().then(setSupport).catch(() => { /* keep the last count */ });
  }, [canSupport]);

  useEffect(() => {
    loadChats();
    loadSupport();
    const id = setInterval(() => { loadChats(); loadSupport(); }, POLL_MS);
    window.addEventListener(CHAT_READ_EVENT, loadChats);
    window.addEventListener(SUPPORT_READ_EVENT, loadSupport);
    return () => {
      clearInterval(id);
      window.removeEventListener(CHAT_READ_EVENT, loadChats);
      window.removeEventListener(SUPPORT_READ_EVENT, loadSupport);
    };
  }, [loadChats, loadSupport]);

  useRealtime((msg) => {
    if (msg?.type === "trip:message" && msg.message?.senderKind === "driver") {
      loadChats();
      setArrived((n) => n + 1);
    } else if (msg?.type === "support:message" && msg.message?.senderKind === "driver") {
      loadSupport();
      setArrived((n) => n + 1);
    } else if (msg?.type === "support:ticket") {
      loadSupport();
    }
  }, undefined, () => { loadChats(); loadSupport(); }); // back after a dropped socket: count what was missed

  const total = chats.reduce((n, r) => n + r.unread, 0) + support.reduce((n, r) => n + r.unread, 0);
  return { chats, support, total, arrived };
}
