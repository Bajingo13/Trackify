import { useState } from "react";
import {
  AlertCircle, AlertTriangle, Bell, CheckCircle2, ChevronRight, LifeBuoy, MessageSquare, PackageX, Smartphone,
} from "lucide-react";
import { ago } from "./ChatInbox";
import "../operations/tripChat.css";

/**
 * What the top-bar bell lists: everything that needs someone's attention now,
 * from every source this person may read.
 *
 * It is sorted into categories, each with its own tab, so a kind of
 * notification can be looked at alone:
 *
 *   Phone codes — a driver on a new phone who could not use the emailed code
 *                 (or is locked out) and asked the office to approve it
 *                 (kind "device" in `alerts`). Often at the roadside, so these lead.
 *   Messages    — drivers' messages nobody has read: `chats` (a run's chat)
 *                 and `support` (a Help & Support request).
 *   Alerts      — the rest of `alerts`: low stock, open exceptions, papers
 *                 running out. The same set as the dashboard's panel.
 *
 * "All" shows every category, with what drivers are waiting on first, in a
 * highlighted section, so it is never lost under stock or paperwork alerts.
 *
 * `alerts` is null while loading, and an empty list when nothing needs anyone.
 * `tab` / `onTab` may be passed to control the tab from outside (the bell
 * opens on Phone codes when a request has just come in).
 */
export const TABS = [
  { id: "all", label: "All" },
  { id: "codes", label: "Phone codes" },
  { id: "messages", label: "Messages" },
  { id: "alerts", label: "Alerts" },
];

const text = (m) => (m?.body?.trim() ? m.body.trim() : m?.hasPhoto ? "Sent a photo" : "New message");

function PhoneRequestRow({ p, onOpen }) {
  const first = String(p.driverName || "the driver").split(" ")[0];
  return (
    <button type="button" className="tc-inbox-row tc-inbox-driver" data-kind="device" data-tone={p.locked ? "critical" : undefined}
      onClick={() => onOpen(p.href)}>
      <span className="tc-inbox-avatar" data-tone={p.locked ? "critical" : undefined} aria-hidden="true"><Smartphone size={18} /></span>
      <span className="tc-inbox-main">
        <span className="tc-inbox-ticket">{p.driverName || "Driver"}{p.employeeNo ? ` · ${p.employeeNo}` : ""}</span>
        <span className="tc-inbox-msg tc-inbox-msg-wrap">
          {p.locked
            ? `Locked out after wrong codes. Call ${first} before approving the new phone.`
            : `Can't get the emailed code and is waiting for you to approve a new phone. Call ${first} first.`}
        </span>
      </span>
      <span className="tc-inbox-side">
        <span className="tc-inbox-new" data-tone={p.locked ? "critical" : "driver"}>{p.locked ? "Locked" : "Code request"}</span>
        {p.askedAt && <span className="tc-inbox-time">{ago(p.askedAt)}</span>}
      </span>
    </button>
  );
}

function ChatRow({ r, onOpen }) {
  return (
    <button type="button" className="tc-inbox-row tc-inbox-driver" data-kind="chat" onClick={() => onOpen(`/operations/trips?trip=${r.tripId}&chat=1`)}>
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
  );
}

function SupportRow({ t, onOpen }) {
  return (
    <button type="button" className="tc-inbox-row tc-inbox-driver" data-kind="support"
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
  );
}

function AlertRow({ a, onOpen }) {
  const tone = a.severity === "critical" ? "critical" : "warning";
  const Icon = a.kind === "inventory"
    ? (a.severity === "critical" ? PackageX : AlertTriangle)
    : AlertCircle;
  return (
    <button type="button" className="tc-inbox-row" data-tone={tone} onClick={() => onOpen(a.href)}>
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
}

function Empty({ children }) {
  return (
    <div className="tc-inbox-empty">
      <span className="tc-inbox-empty-icon tc-inbox-empty-ok"><CheckCircle2 size={18} /></span>
      {children}
    </div>
  );
}

export default function NotificationPanel({
  alerts, chats = [], support = [], onOpen, onDashboard, tab: tabProp, onTab,
}) {
  const [ownTab, setOwnTab] = useState("all");
  const tab = tabProp ?? ownTab;
  const setTab = onTab ?? setOwnTab;

  const loading = alerts === null || alerts === undefined;
  const list = alerts || [];
  const phones = list.filter((a) => a.kind === "device");
  const others = list.filter((a) => a.kind !== "device");
  const unreadMessages = chats.reduce((n, r) => n + r.unread, 0) + support.reduce((n, r) => n + r.unread, 0);
  const conversations = chats.length + support.length;
  const fromDrivers = phones.length + conversations;
  const critical = list.some((a) => a.severity === "critical");
  const total = phones.length + unreadMessages + others.length;

  const counts = { all: total, codes: phones.length, messages: unreadMessages, alerts: others.length };
  // what drivers are waiting on is coloured; the rest is not
  const driverTab = (id) => id === "codes" || id === "messages";

  const phoneRows = phones.map((p) => <PhoneRequestRow key={p.id} p={p} onOpen={onOpen} />);
  const messageRows = [
    ...chats.map((r) => <ChatRow key={`chat-${r.tripId}`} r={r} onOpen={onOpen} />),
    ...support.map((t) => <SupportRow key={`support-${t.id}`} t={t} onOpen={onOpen} />),
  ];
  const alertRows = others.map((a) => <AlertRow key={a.id} a={a} onOpen={onOpen} />);

  return (
    <>
      <div className="tc-inbox-head">
        <span className="tc-inbox-head-icon"><Bell size={20} /></span>
        <span className="tc-inbox-title">Notifications</span>
        {total > 0 && (
          <span className="tc-inbox-total" data-tone={critical || phones.length ? "critical" : fromDrivers ? "driver" : "warning"}>
            {total} new
          </span>
        )}
      </div>

      <div className="tc-inbox-tabs" role="tablist" aria-label="Notification categories">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="tc-inbox-tab"
            onClick={() => setTab(t.id)}>
            {t.label}
            {counts[t.id] > 0 && (
              <span className="tc-inbox-tab-count" data-tone={t.id === "codes" ? "critical" : driverTab(t.id) ? "driver" : undefined}>
                {counts[t.id] > 99 ? "99+" : counts[t.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="tc-inbox-list" role="tabpanel">
        {tab === "all" && (
          <>
            {fromDrivers > 0 && (
              <section className="tc-inbox-section tc-inbox-section-driver" aria-label="From drivers">
                <div className="tc-inbox-section-head">
                  <span className="tc-inbox-pulse" aria-hidden="true" />
                  From drivers · respond first
                  <span className="tc-inbox-section-count">{fromDrivers}</span>
                </div>
                {phoneRows}
                {messageRows}
              </section>
            )}
            {(others.length > 0 || loading) && (
              <section className="tc-inbox-section" aria-label="Other alerts">
                {fromDrivers > 0 && <div className="tc-inbox-section-head">Other alerts<span className="tc-inbox-section-count">{others.length}</span></div>}
                {loading ? <div className="tc-inbox-empty">Loading…</div> : alertRows}
              </section>
            )}
            {!loading && total === 0 && <Empty>Nothing needs attention right now.</Empty>}
          </>
        )}

        {tab === "codes" && (
          loading ? <div className="tc-inbox-empty">Loading…</div>
            : phoneRows.length ? phoneRows
            : <Empty>No driver is waiting for a phone to be approved.</Empty>
        )}

        {tab === "messages" && (messageRows.length ? messageRows : <Empty>No unread messages from drivers.</Empty>)}

        {tab === "alerts" && (
          loading ? <div className="tc-inbox-empty">Loading…</div>
            : alertRows.length ? alertRows
            : <Empty>No other alerts right now.</Empty>
        )}
      </div>

      <button type="button" className="tc-inbox-foot" onClick={onDashboard}>
        Open dashboard <ChevronRight size={15} />
      </button>
    </>
  );
}
