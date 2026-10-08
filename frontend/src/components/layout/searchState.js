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

/**
 * Is this keydown the search shortcut?
 *
 * Plain Ctrl/⌘+K only. Ctrl+Shift+K is Firefox's web console and Alt+Ctrl+K is
 * a layout key on some keyboards, so neither is ours to take; auto-repeat is
 * ignored so holding the keys does not fight the palette; and a rich-text
 * editor keeps its own Ctrl+K (insert link).
 */
export function isSearchShortcut(e) {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.repeat || e.defaultPrevented) return false;
  if (String(e.key || "").toLowerCase() !== "k") return false;
  return !e.target?.isContentEditable;
}

/** What to print next to the search button: ⌘K on a Mac, Ctrl+K elsewhere. */
export function shortcutLabel(platform = typeof navigator === "undefined" ? "" : navigator.userAgentData?.platform || navigator.platform || "") {
  return /mac|iphone|ipad/i.test(platform) ? "⌘K" : "Ctrl+K";
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
