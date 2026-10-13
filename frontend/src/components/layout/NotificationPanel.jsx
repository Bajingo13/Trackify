import { AlertCircle, AlertTriangle, Bell, CheckCircle2, ChevronRight, PackageX } from "lucide-react";
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
 */
export default function NotificationPanel({ alerts, onOpen, onDashboard }) {
  const list = alerts || [];
  const critical = list.filter((a) => a.severity === "critical").length;

  return (
    <>
      <div className="tc-inbox-head">
        <span className="tc-inbox-head-icon"><Bell size={20} /></span>
        <span className="tc-inbox-title">Notifications</span>
        {list.length > 0 && (
          <span className="tc-inbox-total" data-tone={critical ? "critical" : "warning"}>
            {list.length} need attention
          </span>
        )}
      </div>

      <div className="tc-inbox-list">
        {alerts === null && <div className="tc-inbox-empty">Loading…</div>}
        {alerts && list.length === 0 && (
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
