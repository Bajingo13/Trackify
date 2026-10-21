import { useEffect, useRef, useState } from "react";
import { useNetStatus } from "./netStatus";
import NetSign from "./NetSign";

const SHOW_MS = 6000;
export const QUIET_MS = 2 * 60 * 1000;

/**
 * "Slow Connection" once, when the link turns unstable.
 *
 * Shown once each time the state enters unstable. It does not come back while
 * the link stays slow, and at most once every two minutes on a link that keeps
 * flapping. A small pill (NetSign) on the connection layer, not a dialog: it
 * takes no focus and blocks nothing, and the route under it keeps running.
 * "No Connection" is OfflineBar's job, so an offline phone gets no toast.
 */
export default function NetToast() {
  const net = useNetStatus();
  const [open, setOpen] = useState(false);
  const prev = useRef(net);
  const lastShown = useRef(0);

  useEffect(() => {
    const entered = net === "unstable" && prev.current !== "unstable";
    prev.current = net;
    if (net !== "unstable") { setOpen(false); return; }
    if (!entered || Date.now() - lastShown.current < QUIET_MS) return;
    lastShown.current = Date.now();
    setOpen(true);
  }, [net]);

  useEffect(() => {
    if (!open) return undefined;
    const t = window.setTimeout(() => setOpen(false), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  return (
    <NetSign
      show={open}
      tone="warn"
      icon="signalLow"
      label="Slow Connection"
      detail="Slow internet connection. Some features may be delayed. Your route keeps working."
      onClose={() => setOpen(false)}
    />
  );
}
