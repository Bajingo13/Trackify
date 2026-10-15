import { AlertCircle, AlertTriangle, Bell, CheckCircle2, ChevronRight, LifeBuoy, MessageSquare, PackageX } from "lucide-react";
import { ago } from "./ChatInbox";
import "../operations/tripChat.css";

/**
 * What the top-bar bell lists: the things that need someone's attention now,
 * from every source this person may read (low stock, open exceptions, papers
 * running out). The same set as the dashboard's Operational Alerts panel.
 *
 * Laid out like the drivers' messages list beside it so the two read as a pair:
 * a header with a count, a row per item with its icon, what it is, and what
 * kind it is, and a way on to the dashboard. An alert carries no time, so a row
 * shows its category where a message shows how long ago.
 *
 * `alerts` is null while loading, and an empty list when nothing needs anyone.
 *
 * Above them, drivers' messages nobody has read: `chats` (a run's chat) and
 * `support` (a Help & Support request). Each opens its conversation, and
 * stays here until that conversation is read.
 */
export default function NotificationPanel({ alerts, chats = [], support = [], onOpen, onDashboard }) {
  const list = alerts || [];
  const critical = list.filter((a) => a.severity === "critical").length;
  const unreadMessages = chats.reduce((n, r) => n + r.unread, 0) + support.reduce((n, r) => n + r.unread, 0);
  const text = (m) => (m?.body?.trim() ? m.body.trim() : m?.hasPhoto ? "Sent a photo" : "New message");

  return (
    <>
      <div className="tc-inbox-head">
        <span className="tc-inbox-head-icon"><Bell size={20} /></span>
        <span className="tc-inbox-title">Notifications</span>
        {unreadMessages > 0 && (
          <span className="tc-inbox-total">{unreadMessages} unread message{unreadMessages === 1 ? "" : "s"}</span>
        )}
        {list.length > 0 && (
          <span className="tc-inbox-total" data-tone={critical ? "critical" : "warning"}>
            {list.length} need attention
          </span>
        )}
      </div>

      <div className="tc-inbox-list">
        {chats.map((r) => (
          <button key={`chat-${r.tripId}`} type="button" className="tc-inbox-row" onClick={() => onOpen(`/operations/trips?trip=${r.tripId}&chat=1`)}>
            <span className="tc-inbox-avatar" aria-hidden="true"><MessageSquare size={18} /></span>
            <span className="tc-inbox-main">
              <span className="tc-inbox-ticket">{r.lastMessage?.senderName || "Driver"} · {r.ticketNo}</span>
              <span className="tc-inbox-msg">{text(r.lastMessage)}</span>
            </span>
            <span className="tc-inbox-side">
              <span className="tc-inbox-new">{r.unread} new</span>
              {r.lastMessage?.createdAt && <span className="tc-inbox-time">{ago(r.lastMessage.createdAt)}</span>}
            </span>
          </button>
        ))}
        {support.map((t) => (
          <button key={`support-${t.id}`} type="button" className="tc-inbox-row"
            onClick={() => onOpen(t.exceptionId ? `/operations/exceptions?exception=${t.exceptionId}` : "/operations/exceptions")}>
            <span className="tc-inbox-avatar" aria-hidden="true"><LifeBuoy size={18} /></span>
            <span className="tc-inbox-main">
              <span className="tc-inbox-ticket">{t.driverName} · {t.tripNo || t.ticketNo}</span>
              <span className="tc-inbox-msg">{t.subject}{t.preview ? `: ${t.preview}` : ""}</span>
            </span>
            <span className="tc-inbox-side">
              <span className="tc-inbox-new">{t.unread} new</span>
              {t.lastAt && <span className="tc-inbox-time">{ago(t.lastAt)}</span>}
            </span>
          </button>
        ))}
        {alerts === null && <div className="tc-inbox-empty">Loading…</div>}
        {alerts && list.length === 0 && unreadMessages === 0 && (
          <div className="tc-inbox-empty">
            <span className="tc-inbox-empty-icon tc-inbox-empty-ok"><CheckCircle2 size={18} /></span>
            Nothing needs attention right now.
          </div>
        )}
        {list.map((a) => {
          const tone = a.severity === "critical" ? "critical" : "warning";
          const Icon = a.kind === "inventory"
            ? (a.severity === "critical" ? PackageX : AlertTriangle)
            : AlertCircle;
          return (
            <button key={a.id} type="button" className="tc-inbox-row" data-tone={tone} onClick={() => onOpen(a.href)}>
              <span className="tc-inbox-avatar" data-tone={tone} aria-hidden="true"><Icon size={18} /></span>
              <span className="tc-inbox-main">
                <span className="tc-inbox-ticket">{a.title}</span>
                {a.description && <span className="tc-inbox-msg tc-inbox-msg-wrap">{a.description}</span>}
              </span>
              {a.tag && (
                <span className="tc-inbox-side">
                  <span className="tc-inbox-tag" data-tone={tone}>{a.tag}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <button type="button" className="tc-inbox-foot" onClick={onDashboard}>
        Open dashboard <ChevronRight size={15} />
      </button>
    </>
  );
}
