import { useEffect, useState } from "react"
import { readTheme, resolvedTheme, setTheme } from "../theme/theme"
import { tap } from "./native"

/**
 * The Profile screen's single light/dark control.
 *
 * It deliberately shares the same persisted setting as the rest of the
 * driver app, while keeping the two-button login control independent.
 */
export default function ProfileThemeSwitch() {
  const [active, setActive] = useState(() => resolvedTheme(readTheme()))

  useEffect(() => {
    let media
    const sync = () => setActive(resolvedTheme(readTheme()))

    try {
      media = window.matchMedia("(prefers-color-scheme: dark)")
      media.addEventListener?.("change", sync)
      media.addListener?.(sync)
    } catch {
      // Explicit light/dark choices still work in older webviews.
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
    <div className="dr-profile-theme-box dr-profile-box">
      <span className="dr-profile-theme-copy">
        <span className="dr-profile-theme-title">Dark mode</span>
        <span className="dr-profile-theme-detail">Use darker cards for night driving</span>
      </span>
      <button
        type="button"
        className="dr-profile-theme-switch"
        role="switch"
        aria-label="Dark mode"
        aria-checked={dark}
        data-on={dark ? "yes" : "no"}
        onClick={toggle}
      >
        <span className="dr-profile-theme-thumb" aria-hidden="true">
          <SunIcon />
          <MoonIcon />
        </span>
      </button>
    </div>
  )
}

function SunIcon() {
  return (
    <svg className="dr-profile-theme-sun" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="dr-profile-theme-moon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.2 15.3A8.6 8.6 0 0 1 8.7 3.8 8.7 8.7 0 1 0 20.2 15.3Z" />
    </svg>
  )
}
