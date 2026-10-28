import { limitationNotice } from "./capabilities";
import NetSign from "./NetSign";
import NoticePortal from "./NoticePortal";

/**
 * Says plainly what this connection cannot do.
 *
 * Without it the app looks fully functional on a phone reached over the local
 * network, right up until the driver taps "Share my location" and nothing
 * happens. Renders nothing when everything is available.
 */
export default function CapabilityNotice({ floating = false }) {
  const notice = limitationNotice();
  if (!notice) return null;

  if (floating) {
    return (
      <NoticePortal>
        <NetSign tone="warn" icon="alert" label={notice.title} detail={notice.detail} minimizable />
      </NoticePortal>
    );
  }

  return (
    <div className="dr-notice" role="status">
      <div className="dr-notice-title">{notice.title}</div>
      <div className="dr-notice-sub">{notice.detail}</div>
    </div>
  );
}
