import { useEffect, useRef, useState } from "react"

/**
 * The sign-in scene: a run being driven, warehouse to drop-off.
 *
 * Inline SVG and CSS rather than a 3D scene, Rive or Lottie. On the phones
 * that actually carry this app — midrange Android, often several years old —
 * a canvas repainting every frame behind a login form costs battery and heat
 * for something the driver looks at for four seconds. This draws once and
 * animates four transforms, which the compositor handles without waking the
 * main thread.
 *
 * It is decoration, and it behaves like it: the form beneath is interactive
 * from the first frame, the loop pauses when the tab is hidden, and
 * prefers-reduced-motion leaves a still frame of a truck mid-route.
 */
export default function RouteScene() {
  const [visible, setVisible] = useState(true)
  const ref = useRef(null)

  // A driver who backgrounds the app to take a call should not come back to a
  // warm phone. Nothing here is worth animating off-screen.
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden)
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

  return (
    <div className="dr-scene" ref={ref} aria-hidden="true" data-run={visible ? "yes" : "no"}>
      <svg viewBox="0 0 320 132" className="dr-scene-svg" role="presentation">
        <defs>
          <linearGradient id="dr-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f2a63" />
            <stop offset="100%" stopColor="#061128" />
          </linearGradient>
          <linearGradient id="dr-route-done" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#2455d6" />
            <stop offset="100%" stopColor="#4d7bec" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width="320" height="132" fill="url(#dr-sky)" rx="14" />

        {/* A city rather than scenery: the far skyline parallaxes slower than
            the near one, which is what makes a flat scene read as depth. */}
        <g className="dr-skyline dr-skyline-far" fill="#0d2050">
          <rect x="18" y="44" width="14" height="30" />
          <rect x="40" y="52" width="10" height="22" />
          <rect x="96" y="38" width="16" height="36" />
          <rect x="120" y="50" width="11" height="24" />
          <rect x="186" y="46" width="13" height="28" />
          <rect x="230" y="40" width="15" height="34" />
          <rect x="272" y="50" width="10" height="24" />
        </g>
        <g className="dr-skyline dr-skyline-near" fill="#112a63">
          <rect x="0" y="58" width="20" height="18" />
          <rect x="62" y="54" width="16" height="22" />
          <rect x="150" y="60" width="18" height="16" />
          <rect x="206" y="56" width="14" height="20" />
          <rect x="296" y="58" width="18" height="18" />
        </g>

        {/* origin: the yard */}
        <g transform="translate(20, 62)">
          <rect x="0" y="4" width="26" height="14" rx="2" fill="#1d3162" />
          <path d="M0 4 L13 -3 L26 4 Z" fill="#2c4581" />
          <rect x="9" y="10" width="8" height="8" fill="#061128" />
        </g>

        {/* the road already driven, and the road still to drive */}
        <line x1="24" y1="92" x2="292" y2="92" stroke="#16294f" strokeWidth="3" strokeLinecap="round" />
        <line
          x1="24" y1="92" x2="292" y2="92"
          stroke="url(#dr-route-done)" strokeWidth="3" strokeLinecap="round"
          className="dr-route-progress"
        />

        {/* the waypoints light as the truck reaches them */}
        {[96, 160, 224].map((x, i) => (
          <circle
            key={x}
            cx={x} cy="92" r="3.5"
            className="dr-waypoint"
            style={{ animationDelay: `${1.1 + i * 1.25}s` }}
          />
        ))}

        {/* destination */}
        <g transform="translate(286, 74)">
          <path
            d="M6 18 C6 18 12 11 12 6 A6 6 0 0 0 0 6 C0 11 6 18 6 18 Z"
            fill="#4d7bec"
            className="dr-pin"
          />
          <circle cx="6" cy="6" r="2.2" fill="#061128" />
        </g>

        {/* the truck: a box body, which is what most of this fleet is */}
        <g className="dr-truck">
          <g transform="translate(-26, 74)">
            <rect x="0" y="0" width="26" height="14" rx="1.5" fill="#e8eefb" />
            <rect x="26" y="4" width="11" height="10" rx="1.5" fill="#4d7bec" />
            <rect x="29" y="6" width="6" height="4" rx=".8" fill="#bcd0f7" />
            <circle className="dr-wheel" cx="7" cy="15.5" r="3.4" fill="#0a1730" />
            <circle className="dr-wheel" cx="30" cy="15.5" r="3.4" fill="#0a1730" />
            <circle cx="7" cy="15.5" r="1.2" fill="#4d7bec" />
            <circle cx="30" cy="15.5" r="1.2" fill="#4d7bec" />
          </g>
        </g>
      </svg>
    </div>
  )
}
