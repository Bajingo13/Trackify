import { setTextSize, useTextSize } from "./textSize"
import { tap } from "./native"

/**
 * Profile → Appearance → Larger text. One switch, built like Dark mode beside
 * it. Profile is one of the screens it enlarges, so the change shows here the
 * moment it is made.
 */
export default function ProfileTextSize() {
  const on = useTextSize() === "large"
  const toggle = () => {
    tap("light")
    setTextSize(on ? "normal" : "large")
  }

  return (
    <div className="dr-profile-theme-box dr-profile-box dr-textsize">
      <span className="dr-profile-theme-copy">
        <span className="dr-profile-theme-title">Larger text</span>
        <span className="dr-profile-theme-detail">On Today, History, Claims, Profile and Help. The route map stays as it is.</span>
      </span>
      <button
        type="button"
        className="dr-profile-theme-switch"
        role="switch"
        aria-label="Larger text"
        aria-checked={on}
        data-on={on ? "yes" : "no"}
        onClick={toggle}
      >
        <span className="dr-profile-theme-thumb" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19 9.5 5h1L16 19M6.2 14h7.6" />
            <path d="M17 19l2.2-5.5h.6L22 19M17.8 17h3.4" />
          </svg>
        </span>
      </button>
    </div>
  )
}
