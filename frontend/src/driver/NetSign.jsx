import { useEffect, useId, useState } from "react";
import { Icon } from "./DriverIcons";

/* How long a sign takes to fade out. Matches .dr-sign[data-leaving] in driver.css. */
export const EXIT_MS = 200;

/** Keeps a sign on screen for its exit, so it fades out instead of vanishing. */
function useLeaving(show) {
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) { setMounted(true); return undefined; }
    const t = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [show]);
  return { mounted: show || mounted, leaving: !show && mounted };
}

/**
 * A connection sign: a small pill with an icon and a label, floating on its own
 * layer (.dr-netlayer) so it never pushes the screen around.
 *
 * Tapping the label opens the detail underneath. The end button minimizes the
 * pill to its icon (`minimizable`: the sign stays, since the state it reports
 * still holds) or closes it (`onClose`). Enter, exit, opening and minimizing
 * all animate.
 *
 *   show        false fades the sign out
 *   tone        warn | danger | info | ok
 *   icon        a DriverIcons name
 *   label       a few words: "No Connection"
 *   detail      what to know or do, shown when opened
 *   action      { label, onClick }: one button beside the label
 *   defaultOpen start opened (something the driver must read)
 */
export default function NetSign({
  show = true, tone = "warn", icon, label, detail, action, onClose, closeLabel = "Dismiss",
  minimizable = false, defaultOpen = false, role = "status",
}) {
  const { mounted, leaving } = useLeaving(show);
  const [open, setOpen] = useState(defaultOpen);
  const [mini, setMini] = useState(false);
  const detailId = useId();
  if (!mounted) return null;

  const live = leaving ? {} : { role }; // a sign on its way out reports nothing
  if (mini) {
    return (
      <button type="button" className="dr-sign-mini" data-tone={tone} data-leaving={leaving || undefined}
              aria-label={`${label}. Show`} onClick={() => setMini(false)}>
        <Icon name={icon} size={15} />
      </button>
    );
  }

  const face = (
    <>
      <span className="dr-sign-icon"><Icon name={icon} size={14} /></span>
      <span className="dr-sign-label">{label}</span>
    </>
  );
  return (
    <div className="dr-sign" data-tone={tone} data-open={open || undefined} data-leaving={leaving || undefined}
         aria-hidden={leaving || undefined} {...live}>
      <div className="dr-sign-row">
        {detail ? (
          <button type="button" className="dr-sign-main" aria-expanded={open} aria-controls={detailId}
                  onClick={() => setOpen((o) => !o)}>
            {face}
            <svg className="dr-sign-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        ) : (
          <span className="dr-sign-main">{face}</span>
        )}
        {action && (
          <button type="button" className="dr-sign-action" onClick={action.onClick}>{action.label}</button>
        )}
        {(onClose || minimizable) && (
          <button type="button" className="dr-sign-x" aria-label={onClose ? closeLabel : "Minimize"}
                  onClick={() => (onClose ? onClose() : setMini(true))}>
            {onClose ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                   strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                   strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
            )}
          </button>
        )}
      </div>
      {detail && (
        <div className="dr-sign-detail" id={detailId} aria-hidden={!open}>
          <div className="dr-sign-detail-in">{detail}</div>
        </div>
      )}
    </div>
  );
}

/**
 * The same sign, inline in a form or a screen rather than floating: the icon,
 * the label in bold, then one short line.
 */
export function InlineSign({ tone = "warn", icon, label, children, role = "note" }) {
  return (
    <p className="dr-sign-inline" data-tone={tone} role={role}>
      <span className="dr-sign-icon"><Icon name={icon} size={13} /></span>
      <span><b>{label}</b>{children ? <> · {children}</> : null}</span>
    </p>
  );
}
