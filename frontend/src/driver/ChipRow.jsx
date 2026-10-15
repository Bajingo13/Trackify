import { useCallback, useEffect, useRef, useState } from "react"

/**
 * A row of choices on one line that swipes sideways. When there are more than
 * fit, an arrow at the right edge says so, and taps along to them; it goes away
 * once the last one is in view, so a row that fits shows no arrow at all.
 */
export default function ChipRow({ label, className = "", children }) {
  const scroller = useRef(null)
  const [more, setMore] = useState(false)

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4)
  }, [])

  useEffect(() => {
    measure()
    const el = scroller.current
    if (!el || typeof ResizeObserver === "undefined") return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, children])

  const next = () => {
    const el = scroller.current
    const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (el) el.scrollBy?.({
      left: Math.max(120, el.clientWidth * 0.7),
      behavior: reducedMotion ? "auto" : "smooth",
    })
  }

  return (
    <div className={`dr-chiprow ${className}`} data-more={more ? "yes" : "no"}>
      <div ref={scroller} className="dr-chips dr-chiprow-scroll" role="group" aria-label={label} onScroll={measure}>
        {children}
      </div>
      {more && (
        <button type="button" className="dr-chiprow-more" aria-label="Show more choices" onClick={next}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </button>
      )}
    </div>
  )
}
