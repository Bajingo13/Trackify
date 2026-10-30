import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./DriverIcons";

/* How long a sign takes to fade out. Matches .dr-sign[data-leaving] in driver.css. */
export const EXIT_MS = 200;
export const MORPH_MS = 280;
const HEAD_DIAMETER = 48;

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

function readMinimized(key) {
  if (!key) return false;
  try {
    return sessionStorage.getItem(`trackify-notice-mini:${key}`) === "1";
  } catch {
    return false;
  }
}

function saveMinimized(key, minimized) {
  if (!key) return;
  try {
    if (minimized) sessionStorage.setItem(`trackify-notice-mini:${key}`, "1");
    else sessionStorage.removeItem(`trackify-notice-mini:${key}`);
  } catch {
    /* The current screen still keeps the state when storage is unavailable. */
  }
}

/**
 * A connection sign: a small pill with an icon and a label, floating on its own
 * layer (.dr-netlayer) so it never pushes the screen around.
 *
 * The message is shown directly, without a second dropdown interaction. The
 * end button minimizes the banner to its icon (`minimizable`: the sign stays,
 * since the state it reports still holds) or closes it (`onClose`).
 *
 *   show        false fades the sign out
 *   tone        warn | danger | info | ok
 *   icon        a DriverIcons name
 *   label       a few words: "No Connection"
 *   detail      what to know or do, shown below the label
 *   action      { label, onClick }: one button beside the label
 *   rememberKey keeps a minimized notice compact across page changes
 */
export default function NetSign({
  show = true, tone = "warn", icon, label, detail, action, onClose, closeLabel = "Dismiss",
  minimizable = false, rememberKey, role = "status",
}) {
  const { mounted, leaving } = useLeaving(show);
  const [mode, setMode] = useState(() => readMinimized(rememberKey) ? "mini" : "full");
  const [morph, setMorph] = useState({ x: 0, y: 0 });
  const signRef = useRef(null);
  const transitionTimer = useRef(null);
  const restoreOrigin = useRef(null);

  const reducedMotion = () =>
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const finishTransition = (next) => {
    window.clearTimeout(transitionTimer.current);
    transitionTimer.current = window.setTimeout(() => setMode(next), MORPH_MS);
  };

  const minimize = (event) => {
    event?.stopPropagation();
    if (mode !== "full") return;
    saveMinimized(rememberKey, true);
    if (reducedMotion()) {
      setMode("mini");
      return;
    }
    const rect = signRef.current?.getBoundingClientRect();
    const layer = signRef.current?.closest(".dr-netlayer")?.getBoundingClientRect();
    if (rect) {
      const targetX = (layer?.right ?? window.innerWidth - 12) - HEAD_DIAMETER / 2;
      const targetY = rect.top + HEAD_DIAMETER / 2;
      setMorph({
        x: targetX - (rect.left + rect.width / 2),
        y: targetY - (rect.top + rect.height / 2),
      });
    }
    setMode("minimizing");
    finishTransition("mini");
  };

  const restore = (event) => {
    event.stopPropagation();
    if (mode !== "mini") return;
    saveMinimized(rememberKey, false);
    if (reducedMotion()) {
      setMode("full");
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    restoreOrigin.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    setMode("restore-measure");
  };

  useLayoutEffect(() => {
    if (mode !== "restore-measure" || !signRef.current || !restoreOrigin.current) return;
    const rect = signRef.current.getBoundingClientRect();
    setMorph({
      x: restoreOrigin.current.x - (rect.left + rect.width / 2),
      y: restoreOrigin.current.y - (rect.top + rect.height / 2),
    });
    setMode("restoring");
    finishTransition("full");
  }, [mode]);

  useEffect(() => () => window.clearTimeout(transitionTimer.current), []);

  if (!mounted) return null;

  const transitioningOut = leaving || mode === "minimizing";
  const live = transitioningOut ? {} : { role }; // a sign on its way out reports nothing
  if (mode === "mini") {
    return (
      <button type="button" className="dr-sign-mini" data-tone={tone} data-leaving={leaving || undefined}
              aria-label={`${label}. Show`} title={`Show ${label}`} onClick={restore}>
        <Icon name={icon} size={20} />
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
    <div
      ref={signRef}
      className="dr-sign"
      data-tone={tone}
      data-leaving={leaving || undefined}
      data-minimizing={mode === "minimizing" || undefined}
      data-restore-measure={mode === "restore-measure" || undefined}
      data-restoring={mode === "restoring" || undefined}
      aria-hidden={transitioningOut || undefined}
      style={{ "--sign-morph-x": `${morph.x}px`, "--sign-morph-y": `${morph.y}px` }}
      {...live}
    >
      <div className="dr-sign-row">
        <span className="dr-sign-main">{face}</span>
        {action && (
          <button type="button" className="dr-sign-action" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>
        )}
        {(onClose || minimizable) && (
          <button type="button" className="dr-sign-x" aria-label={onClose ? closeLabel : "Minimize"}
                  onClick={(event) => (onClose ? onClose() : minimize(event))}>
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
        <div className="dr-sign-detail">
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
