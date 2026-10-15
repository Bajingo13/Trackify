import { useEffect, useState } from "react"
import { readTheme, resolvedTheme, setTheme } from "../theme/theme"
import { tap } from "./native"

/**
 * The compact light/dark switch used over the Driver sign-in artwork.
 *
 * It follows the same sliding sun/moon pattern as the labelled Profile
 * control. The current system appearance is respected on first open; once the
 * driver changes it, the shared theme utility persists that explicit choice
 * across reloads and native app launches.
 */
export default function DriverThemeToggle() {
  const [active, setActive] = useState(() => resolvedTheme(readTheme()))

  useEffect(() => {
    let media
    const sync = () => setActive(resolvedTheme(readTheme()))

    try {
      media = window.matchMedia("(prefers-color-scheme: dark)")
      media.addEventListener?.("change", sync)
      media.addListener?.(sync)
    } catch {
      // Older webviews do not expose matchMedia; the explicit switch still does.
    }

    window.addEventListener("storage", sync)
    return () => {
      media?.removeEventListener?.("change", sync)
      media?.removeListener?.(sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  const dark = active === "dark"
  const toggle = () => {
    const next = dark ? "light" : "dark"
    tap("light")
    setTheme(next)
    setActive(next)
  }

  return (
    <button
      type="button"
      className="dr-theme-switch"
      role="switch"
      aria-label="Dark mode"
      aria-checked={dark}
      data-on={dark ? "yes" : "no"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggle}
    >
      <span className="dr-theme-switch-thumb" aria-hidden="true">
        <SunIcon />
        <MoonIcon />
      </span>
    </button>
  )
}

function SunIcon() {
  return (
    <svg className="dr-theme-switch-sun" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="dr-theme-switch-moon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.2 15.3A8.6 8.6 0 0 1 8.7 3.8 8.7 8.7 0 1 0 20.2 15.3Z" />
    </svg>
  )
}
