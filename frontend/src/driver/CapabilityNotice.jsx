import { limitationNotice } from "./capabilities";

/**
 * Says plainly what this connection cannot do.
 *
 * Without it the app looks fully functional on a phone reached over the local
 * network, right up until the driver taps "Share my location" and nothing
 * happens. Renders nothing when everything is available.
 */
export default function CapabilityNotice() {
  const notice = limitationNotice();
  if (!notice) return null;

  return (
    <div className="dr-notice" role="status">
      <div className="dr-notice-title">{notice.title}</div>
      <div className="dr-notice-sub">{notice.detail}</div>
    </div>
  );
}
