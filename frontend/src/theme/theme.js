/**
 * Theme preference: "light", "dark" or "system".
 *
 * The token sheet already defines all three states — a bare :root for light,
 * a prefers-color-scheme block for the un-stamped system default, and a
 * [data-theme] block that wins over both. All this does is stamp the root
 * element and remember the choice.
 */

const KEY = "tk_theme";
export const THEMES = ["light", "dark", "system"];

export function readTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v) ? v : "system";
  } catch {
    return "system";
  }
}

/** Stamps the root element. "system" removes the stamp so the media query wins. */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  root.style.colorScheme = theme === "system" ? "light dark" : theme;

  // Keep the browser/Android status bar joined visually to the app. Driver
  // builds already ship a theme-color meta tag; updating it here means the
  // persisted choice is correct before React paints, without a light flash.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.content = resolvedTheme(theme) === "dark" ? "#0c111b" : "#f1f5fb";
  }
}

export function setTheme(theme) {
  const next = THEMES.includes(theme) ? theme : "system";
  try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
  applyTheme(next);
  return next;
}

/** What the user actually sees right now, resolving "system". */
export function resolvedTheme(theme = readTheme()) {
  if (theme !== "system") return theme;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Applied once at boot, before React renders, so there is no flash. */
export function initTheme() {
  applyTheme(readTheme());
}
