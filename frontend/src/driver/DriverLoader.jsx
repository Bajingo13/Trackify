import { useEffect, useState } from "react";
import "./driver-loader.css";

/**
 * The Driver App's layout-aware skeleton loader. Full screens mirror the
 * content about to replace them, while inline waits use a compact row shape.
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
 * `label` is always announced to screen readers. Placeholders are decorative.
 */
const SHOW_AFTER_MS = 300;

export default function DriverLoader({ label = "Loading…", variant = "overlay", delay, skeleton = null }) {
  const wait = delay ?? (variant === "overlay" ? 0 : SHOW_AFTER_MS);
  const skeletonKind = skeleton || (variant === "inline" ? "inline" : "generic");
  const [shown, setShown] = useState(wait <= 0);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const id = setTimeout(() => setShown(true), wait);
    return () => clearTimeout(id);
  }, [wait]);

  return (
    <div
      className={`dr-loader dr-loader--${variant}${skeletonKind ? ` dr-loader--skeleton-${skeletonKind}` : ""}${shown ? "" : " is-waiting"}`}
      role="status"
      aria-live="polite"
      aria-label={label}
      aria-busy="true"
    >
      {shown && (
        skeletonKind === "home"
          ? <HomeSkeleton />
          : skeletonKind === "inline"
            ? <InlineSkeleton />
            : <GenericScreenSkeleton />
      )}
    </div>
  );
}
/** A compact placeholder for photos, messages, maps, and other inline waits. */
export function InlineSkeleton() {
  return (
    <div className="dr-skeleton-inline" aria-hidden="true">
      <span className="dr-skeleton-inline-thumb" />
      <span className="dr-skeleton-inline-copy">
        <SkeletonLine width="64%" strong />
        <SkeletonLine width="88%" />
        <SkeletonLine width="46%" />
      </span>
    </div>
  );
}

/** Common list/detail geometry for full screens without a purpose-built skeleton. */
export function GenericScreenSkeleton() {
  return (
    <div className="dr-skeleton-screen" aria-hidden="true">
      <section className="dr-skeleton-screen-lead">
        <span className="dr-skeleton-screen-avatar" />
        <span className="dr-skeleton-screen-lead-copy">
          <SkeletonLine width="56%" strong />
          <SkeletonLine width="78%" />
          <SkeletonLine width="42%" />
        </span>
      </section>
      <div className="dr-skeleton-screen-heading"><SkeletonLine width="124px" strong /></div>
      <section className="dr-skeleton-screen-list">
        {[0, 1, 2, 3].map((item) => (
          <span className="dr-skeleton-screen-row" key={item}>
            <span className="dr-skeleton-screen-row-copy">
              <SkeletonLine width={item % 2 ? "48%" : "62%"} strong />
              <SkeletonLine width="82%" />
              <SkeletonLine width="38%" />
            </span>
            <span className="dr-skeleton-screen-end" />
          </span>
        ))}
      </section>
    </div>
  );
}

/** The Today screen before its trips arrive, shaped like the content replacing it. */
export function HomeSkeleton() {
  return (
    <div className="dr-skeleton-home" aria-hidden="true">
      <div className="dr-skeleton-stats">
        {[0, 1, 2].map((item) => (
          <div className="dr-skeleton-stat" key={item}>
            <SkeletonLine width="58%" />
            <SkeletonLine width={item === 1 ? "46%" : "66%"} strong />
          </div>
        ))}
      </div>

      <div className="dr-skeleton-current">
        <div className="dr-skeleton-current-head">
          <div className="dr-skeleton-stack">
            <SkeletonLine width="76px" dark />
            <SkeletonLine width="112px" dark strong />
          </div>
          <span className="dr-skeleton-pill dr-skeleton-dark" />
        </div>

        <div className="dr-skeleton-vehicle">
          <span className="dr-skeleton-plate" />
          <span className="dr-skeleton-truck">
            <i className="dr-skeleton-truck-box" />
            <i className="dr-skeleton-truck-cab" />
            <i className="dr-skeleton-wheel one" />
            <i className="dr-skeleton-wheel two" />
          </span>
        </div>
        <div className="dr-skeleton-road" />

        <div className="dr-skeleton-current-body">
          <div className="dr-skeleton-progress">
            {[0, 1, 2, 3].map((item) => (
              <span className="dr-skeleton-progress-step" key={item}>
                <i />
                <b />
              </span>
            ))}
          </div>
          <div className="dr-skeleton-route">
            <span><SkeletonLine width="48px" /><SkeletonLine width="88px" strong /></span>
            <i className="dr-skeleton-route-dash" />
            <span className="end"><SkeletonLine width="48px" /><SkeletonLine width="104px" strong /></span>
          </div>
          <div className="dr-skeleton-cargo">
            <SkeletonLine width="52px" />
            <SkeletonLine width="72%" />
          </div>
        </div>
        <div className="dr-skeleton-current-foot"><SkeletonLine width="92px" strong /></div>
      </div>

      <div className="dr-skeleton-section">
        <SkeletonLine width="112px" strong />
        <span className="dr-skeleton-count" />
      </div>

      <div className="dr-skeleton-runs">
        {[0, 1].map((item) => (
          <div className="dr-skeleton-run" key={item}>
            <span className="dr-skeleton-run-art" />
            <span className="dr-skeleton-run-copy">
              <SkeletonLine width={item ? "48%" : "58%"} strong />
              <SkeletonLine width="76%" />
              <SkeletonLine width="42%" />
            </span>
            <span className="dr-skeleton-chevron" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SkeletonLine({ width = "100%", strong = false, dark = false }) {
  return (
    <span
      className={`dr-skeleton-line${strong ? " is-strong" : ""}${dark ? " dr-skeleton-dark" : ""}`}
      style={{ width }}
    />
  );
}

