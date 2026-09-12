/**
 * The sign-in hero: a tractor unit seen front three-quarter, lit from the
 * front-left, filling the frame the way a photograph would.
 *
 * Drawn rather than photographed because a licensed stock shot is not
 * something this project has. Depth comes from three things: a warm rim light
 * down the near edge, a dark scrim under the chassis, and the trailer
 * receding on a shallower angle than the cab.
 *
 * The viewBox is portrait and roughly phone-shaped on purpose. A landscape
 * box behind `slice` on a tall screen scales to cover and crops to a corner
 * of the cab — which is what a wide composition here looked like.
 */
export default function HeroTruck({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 420 860"
      fill="none"
      role="presentation"
      aria-hidden="true"
      preserveAspectRatio="xMidYMax slice"
    >
      <defs>
        <linearGradient id="ht-sky" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#0d2360" />
          <stop offset="42%" stopColor="#081b45" />
          <stop offset="78%" stopColor="#05122c" />
          <stop offset="100%" stopColor="#04091a" />
        </linearGradient>
        <linearGradient id="ht-cab" x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0%" stopColor="#4a7cf0" />
          <stop offset="46%" stopColor="#2455d6" />
          <stop offset="100%" stopColor="#16327d" />
        </linearGradient>
        <linearGradient id="ht-cab-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1c3f9e" />
          <stop offset="100%" stopColor="#102963" />
        </linearGradient>
        <linearGradient id="ht-trailer" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="#eef3fc" />
          <stop offset="100%" stopColor="#8ea3c8" />
        </linearGradient>
        <linearGradient id="ht-glass" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#a9cdff" />
          <stop offset="100%" stopColor="#16336d" />
        </linearGradient>
        <radialGradient id="ht-beam" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#ffe9b8" stopOpacity=".9" />
          <stop offset="100%" stopColor="#ffe9b8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ht-ground" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#000" stopOpacity=".6" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ht-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#2455d6" stopOpacity=".55" />
          <stop offset="100%" stopColor="#2455d6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ht-scrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#04091a" stopOpacity="0" />
          <stop offset="58%" stopColor="#04091a" stopOpacity=".72" />
          <stop offset="100%" stopColor="#04091a" />
        </linearGradient>
      </defs>

      <rect width="420" height="860" fill="url(#ht-sky)" />

      {/* a wash behind the cab so it separates from the sky */}
      <ellipse cx="250" cy="470" rx="300" ry="200" fill="url(#ht-glow)" />

      {/* horizon haze and road */}
      <ellipse cx="210" cy="596" rx="280" ry="58" fill="#143576" opacity=".45" />
      <rect x="0" y="600" width="420" height="260" fill="#050d20" />

      {/* lane markings running away from the viewer */}
      <g opacity=".2" fill="#8fb0e8">
        <path d="M186 860 L202 616 L212 616 L206 860 Z" />
        <path d="M40 860 L136 620 L146 620 L70 860 Z" opacity=".55" />
        <path d="M392 860 L292 620 L302 620 L420 848 Z" opacity=".55" />
      </g>

      <ellipse cx="220" cy="690" rx="180" ry="34" fill="url(#ht-ground)" />

      {/* ---- trailer, receding to the left ---- */}
      <path d="M22 372 L150 352 L150 600 L22 588 Z" fill="url(#ht-trailer)" />
      <path d="M22 372 L150 352 L150 374 L22 394 Z" fill="#ffffff" opacity=".5" />
      <g opacity=".26" stroke="#5a7099" strokeWidth="2">
        <line x1="50" y1="378" x2="50" y2="590" />
        <line x1="78" y1="374" x2="78" y2="593" />
        <line x1="106" y1="370" x2="106" y2="596" />
        <line x1="134" y1="365" x2="134" y2="598" />
      </g>
      <path d="M22 588 L150 600 L150 626 L22 610 Z" fill="#0b1631" />

      {/* ---- cab ---- */}
      <path d="M150 344 L272 328 L272 600 L150 600 Z" fill="url(#ht-cab-side)" />
      <path d="M272 328 L366 352 L366 596 L272 600 Z" fill="url(#ht-cab)" />

      {/* windscreen wrapping the corner */}
      <path d="M280 352 L356 372 L356 438 L280 424 Z" fill="url(#ht-glass)" />
      <path d="M280 352 L356 372 L356 388 L280 370 Z" fill="#d6e7ff" opacity=".42" />
      <path d="M160 356 L264 342 L264 424 L160 432 Z" fill="url(#ht-glass)" opacity=".8" />

      {/* sun visor */}
      <path d="M274 330 L370 356 L370 370 L274 344 Z" fill="#12285f" />

      {/* grille */}
      <rect x="288" y="456" width="70" height="66" rx="7" fill="#0a1631" />
      <g fill="#5b81cf" opacity=".8">
        <rect x="296" y="466" width="54" height="6" rx="3" />
        <rect x="296" y="480" width="54" height="6" rx="3" />
        <rect x="296" y="494" width="54" height="6" rx="3" />
        <rect x="296" y="508" width="54" height="6" rx="3" />
      </g>

      {/* headlights, and the light they throw down the road */}
      <ellipse cx="330" cy="540" rx="190" ry="90" fill="url(#ht-beam)" opacity=".26" />
      <rect x="286" y="530" width="32" height="16" rx="6" fill="#ffeec4" />
      <rect x="330" y="534" width="30" height="16" rx="6" fill="#ffeec4" opacity=".92" />

      {/* bumper */}
      <path d="M276 558 L366 566 L366 600 L276 596 Z" fill="#0e1d42" />
      <path d="M276 558 L366 566 L366 574 L276 566 Z" fill="#4a7cf0" opacity=".45" />

      {/* stack and mirror — the details that read as a real cab */}
      <rect x="264" y="300" width="12" height="120" rx="6" fill="#22366a" />
      <path d="M366 386 L392 396 L392 448 L366 438 Z" fill="#12285f" />

      {/* rim light down the near edge */}
      <path d="M366 352 L371 353 L371 596 L366 596 Z" fill="#a9cdff" opacity=".7" />

      {/* ---- wheels ---- */}
      <g>
        <ellipse cx="330" cy="626" rx="46" ry="46" fill="#060d1f" />
        <ellipse cx="330" cy="626" rx="23" ry="23" fill="#1b2c53" />
        <ellipse cx="330" cy="626" rx="10" ry="10" fill="#4a7cf0" />
        <ellipse cx="176" cy="628" rx="38" ry="38" fill="#060d1f" />
        <ellipse cx="176" cy="628" rx="18" ry="18" fill="#1b2c53" />
        <ellipse cx="92" cy="628" rx="34" ry="34" fill="#060d1f" />
        <ellipse cx="92" cy="628" rx="16" ry="16" fill="#1b2c53" />
      </g>

      {/* scrim, so the headline always has something to sit on */}
      <rect x="0" y="470" width="420" height="390" fill="url(#ht-scrim)" />
    </svg>
  )
}
