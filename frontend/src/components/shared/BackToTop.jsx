import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import "./tablePager.css";

/** How far down the page has to be before the button is worth showing. */
const SHOW_AFTER_PX = 400;

/**
 * A button that returns to the top of the page, shown only once the page has been
 * scrolled. It scrolls smoothly, unless the person asked their system for less motion.
 */
export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  const goTop = () => {
    const calm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: calm ? "auto" : "smooth" });
  };

  return (
    <button type="button" className="tk-backtotop" onClick={goTop} aria-label="Back to top" title="Back to top">
      <ArrowUp size={20} />
    </button>
  );
}
