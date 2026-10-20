import { useEffect, useId, useState } from "react";
import "./driver-loader.css";

/**
 * The Driver App's one loading indicator: the location pin from the Trackify
 * wordmark — same teardrop, same sky-to-periwinkle gradient, same forward lean —
 * bouncing over a ring of dashes that turns beneath it like a spot on a map.
 *
 * Kept for waits a driver actually feels, never for moving between screens
 * (those are plain transitions, driver.css .dr-screen):
 *
 *   overlay — full screen, swallows taps: signing in and out, restoring the
 *             app before it can open, and a trip action the driver must not
 *             tap through. Shows at once.
 *   screen  — a whole screen whose data has not arrived yet.
 *   inline  — a list, thread or panel inside a screen.
 *
 * `screen` and `inline` hold back for SHOW_AFTER_MS: data that arrives quicker
 * than that just appears, with no flash of a loader. Until then the space is
 * kept, so nothing jumps when the content or the mark arrives.
 *
 * `label` is said to screen readers always, and shown under the mark.
 */
const SHOW_AFTER_MS = 300;

export default function DriverLoader({ label = "Loading…", variant = "overlay", delay }) {
  const wait = delay ?? (variant === "overlay" ? 0 : SHOW_AFTER_MS);
  const [shown, setShown] = useState(wait <= 0);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const id = setTimeout(() => setShown(true), wait);
    return () => clearTimeout(id);
  }, [wait]);

  const size = variant === "inline" ? "sm" : "lg";
  return (
    <div
      className={`dr-loader dr-loader--${variant}${shown ? "" : " is-waiting"}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {shown && (
        <>
          <PinMark size={size} />
          <div className="dr-loader-label" aria-hidden="true">{label}</div>
        </>
      )}
    </div>
  );
}

/** The bouncing pin, its shadow, and the turning ring. Decorative: the parent carries the label. */
export function PinMark({ size = "lg" }) {
  // Each mark needs its own gradient ids: two on one page must not share one.
  const id = useId().replace(/:/g, "");
  return (
    <span className={`dr-pinmark dr-pinmark--${size}`} aria-hidden="true">
      <span className="dr-pinmark-ground">
        <svg className="dr-pinmark-ring" viewBox="0 0 100 100" focusable="false">
          <defs>
            <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#38bdf8" />
              <stop offset="1" stopColor="#78a2ff" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="40" stroke={`url(#${id}-ring)`} />
        </svg>
      </span>
      <span className="dr-pinmark-shadow" />
      {/* The wordmark's own pin (trackify-logo.svg), with its lean */}
      <svg className="dr-pinmark-pin" viewBox="-5 -1 28 42" focusable="false">
        <defs>
          <linearGradient id={`${id}-pin`} x1="0" y1="0" x2="0" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#38bdf8" />
            <stop offset="1" stopColor="#78a2ff" />
          </linearGradient>
        </defs>
        <g transform="translate(4 0) skewX(-12)">
          <path
            fill={`url(#${id}-pin)`}
            fillRule="evenodd"
            d="M9.5 40L0.47 12.46A9.5 9.5 0 1 1 18.53 12.46ZM13.5 9.5A4 4 0 1 0 5.5 9.5A4 4 0 1 0 13.5 9.5Z"
          />
        </g>
      </svg>
    </span>
  );
}

