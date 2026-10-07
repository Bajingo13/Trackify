import { useSyncExternalStore } from "react";

/**
 * Whether the search palette is open, kept outside React.
 *
 * Several pages rebuild the application frame while they load, and anything
 * held in the frame's own state — including an open palette — would be reset
 * with it. A store here survives that, and `openSearch` is idempotent so two
 * frames listening for Ctrl+K cannot cancel each other out.
 */
let open = false;
const listeners = new Set();

function set(next) {
  if (open === next) return;
  open = next;
  listeners.forEach((fn) => fn());
}

export const openSearch = () => set(true);
export const closeSearch = () => set(false);

export function useSearchOpen() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => open,
    () => false,
  );
}
