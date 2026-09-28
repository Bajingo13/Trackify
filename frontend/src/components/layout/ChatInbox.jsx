import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { MessageSquare } from "lucide-react";
import { usePermissions } from "../../auth/permissions";
import { useRealtime } from "../../services/realtime";
import { CHAT_READ_EVENT, getUnread } from "../../services/operations/chatService";
import "../operations/tripChat.css";

/**
 * Drivers' unread messages, from any page.
 *
 * A driver at a locked gate should not wait for a dispatcher who happens to
 * be on the invoices screen to wander over to Live Tracking. This sits in the
 * top bar beside the alerts, counts driver messages this person has not read,
 * and opens the trip with its conversation already showing.
 *
 * Counts come from the server. A driver's message arriving over the realtime
 * socket triggers a re-count; a read anywhere in the console announces itself
 * (see TripChat) so the number drops at once; a slow poll covers a dead socket.
 */
const POLL_MS = 60000;

export default function ChatInbox() {
  const { can } = usePermissions();
  const allowed = can("tracking.read");
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const load = useCallback(async () => {
    if (!allowed) return;
    try { setRows(await getUnread()); } catch { /* keep the last count */ }
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return undefined;
    load();
    const id = setInterval(load, POLL_MS);
    window.addEventListener(CHAT_READ_EVENT, load);
    return () => { clearInterval(id); window.removeEventListener(CHAT_READ_EVENT, load); };
  }, [allowed, load]);

  useRealtime((msg) => {
    if (msg?.type === "trip:message" && msg.message?.senderKind === "driver") load();
  });

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!allowed) return null;
  const total = rows.reduce((n, r) => n + r.unread, 0);

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => setOpen((o) => !o)}
        aria-label={total ? `Driver messages (${total} unread)` : "Driver messages"}
        aria-expanded={open}
        style={{ position: "relative", padding: 7, border: "none", background: open ? "var(--surface-sunk)" : "transparent", cursor: "pointer", color: open ? "var(--text)" : "var(--text-2)", borderRadius: "var(--r-xs)" }}
      >
        <MessageSquare size={16} />
        {total > 0 && (
          <span
            style={{
              position: "absolute", top: 2, right: 2, minWidth: 15, height: 15, padding: "0 3px",
              borderRadius: "var(--r-pill)", background: "var(--accent)",
              color: "var(--text-on-accent)", fontSize: 9, fontWeight: 700, lineHeight: "15px", textAlign: "center",
              border: "2px solid var(--surface)", boxSizing: "content-box",
            }}
          >
            {total > 9 ? "9+" : total}
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            style={{
              position: "absolute", right: 0, top: "calc(100% + 8px)", width: 300, maxWidth: "calc(100vw - 32px)",
              background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-md)",
              boxShadow: "var(--shadow-3)", zIndex: 80, overflow: "hidden",
            }}
          >
            <div style={{ padding: "10px 13px", borderBottom: "1px solid var(--line-soft)", fontSize: "var(--fs-13)", fontWeight: 700, color: "var(--text)" }}>
              Messages from drivers
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {rows.length === 0 && (
                <div style={{ padding: "18px 13px", fontSize: "var(--fs-13)", color: "var(--text-2)" }}>
                  No unread messages.
                </div>
              )}
              {rows.map((r) => (
                <button
                  key={r.tripId}
                  type="button"
                  onClick={() => { setOpen(false); navigate(`/operations/trips?trip=${r.tripId}&chat=1`); }}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, width: "100%",
                    textAlign: "left", padding: "10px 13px", border: "none", borderBottom: "1px solid var(--line-soft)",
                    background: "transparent", cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span className="tk-mono" style={{ fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text)" }}>{r.ticketNo}</span>
                  <span className="tc-badge">{r.unread} new</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
