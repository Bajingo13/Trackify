import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query.
 *
 *   const isNarrow = useMediaQuery("(max-width: 900px)");
 *
 * Returns false during SSR / when matchMedia is unavailable.
 */
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia(query);
    } catch {
      return;
    }
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [query]);

  return matches;
}
