import { useEffect, useRef, useState } from "react"

/** How far down the screen has to be scrolled before the button is worth showing. */
const SHOW_AFTER_PX = 300

/**
 * A button that returns to the top of the screen it is in, shown once that screen has been scrolled.
 * Put it as the last thing inside a scrolling screen (.dr-scroll). It gets its own bottom row so
 * pagination and other trailing controls remain visible and tappable.
 */
export default function BackToTop() {
  const anchor = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const scroller = anchor.current?.closest(".dr-scroll")
    if (!scroller) return undefined
    const onScroll = () => setVisible(scroller.scrollTop > SHOW_AFTER_PX)
    onScroll()
    scroller.addEventListener("scroll", onScroll, { passive: true })
    return () => scroller.removeEventListener("scroll", onScroll)
  }, [])

  const goTop = () => {
    const calm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    anchor.current?.closest(".dr-scroll")?.scrollTo?.({ top: 0, behavior: calm ? "auto" : "smooth" })
  }

  return (
    <div ref={anchor} className={`dr-top-anchor${visible ? " is-visible" : ""}`}>
      {visible && (
        <button type="button" className="dr-top-btn" onClick={goTop} aria-label="Back to top">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          <span>Back to top</span>
        </button>
      )}
    </div>
  )
}
