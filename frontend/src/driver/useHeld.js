import { useEffect, useRef, useState } from "react";

/**
 * True while `active` is, and for at least `minMs` after it first turned on.
 *
 * On a good connection a status change comes back in a couple of hundred
 * milliseconds, which as a full-screen loader is a flash rather than a signal.
 * Holding it a beat longer makes it read as "that went through" instead of a
 * glitch, and costs nothing when the request is genuinely slow.
 */
export function useHeld(active, minMs = 700) {
  const [held, setHeld] = useState(false);
  const since = useRef(0);

  useEffect(() => {
    if (active) {
      since.current = Date.now();
      setHeld(true);
      return undefined;
    }
    const left = Math.max(0, minMs - (Date.now() - since.current));
    const id = setTimeout(() => setHeld(false), left);
    return () => clearTimeout(id);
  }, [active, minMs]);

  return active || held;
}
