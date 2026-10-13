import { useEffect, useState } from "react"
import { readTheme, resolvedTheme, setTheme } from "../theme/theme"

/**
 * A deliberately small, two-choice control for a cab-sized screen.
 *
 * The staff app offers a third "system" setting. Here the current system
 * appearance is still respected on first open, but the visible choices stay
 * unambiguous: sunlight and night. Once selected, the shared theme utility
 * persists the choice across reloads and native app launches.
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
      // Older webviews do not expose matchMedia; the explicit buttons still do.
    }

    window.addEventListener("storage", sync)
    return () => {
      media?.removeEventListener?.("change", sync)
      media?.removeListener?.(sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  const choose = (theme) => {
    setTheme(theme)
    setActive(theme)
  }

  return (
    <div className="dr-theme" role="group" aria-label="Appearance">
      <button
        type="button"
        className="dr-theme-choice"
        data-on={active === "light" ? "yes" : "no"}
        aria-label="Use light mode"
        aria-pressed={active === "light"}
        title="Light mode"
        onClick={() => choose("light")}
      >
        <SunIcon />
      </button>
      <button
        type="button"
        className="dr-theme-choice"
        data-on={active === "dark" ? "yes" : "no"}
        aria-label="Use dark mode"
        aria-pressed={active === "dark"}
        title="Dark mode"
        onClick={() => choose("dark")}
      >
        <MoonIcon />
      </button>
    </div>
  )
}

function SunIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.2 15.3A8.6 8.6 0 0 1 8.7 3.8 8.7 8.7 0 1 0 20.2 15.3Z" />
    </svg>
  )
}
