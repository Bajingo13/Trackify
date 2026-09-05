/**
 * Side-profile vehicle illustrations, drawn inline as SVG so they scale, theme
 * with the design tokens (light/dark), and need no image assets.
 *
 * One shared chassis + cab, with the cargo section swapped per vehicle type.
 * Every colour comes from the token set — no hard-coded palette.
 *
 * `load` (0..1) paints a proportional load-level fill inside the cargo body,
 * so a truck reads as "how full is it" at a glance.
 */

const VARIANTS = {
  "Box Truck": "box",
  "Furniture Truck": "box",
  "Closed Van": "van",
  "Refrigerated Van": "reefer",
  "Flatbed Truck": "flatbed",
  Trailer: "trailer",
  Motorcycle: "moto",
};

export function variantFor(type) {
  return VARIANTS[type] || "box";
}

/** the fillable cargo region per variant, in viewBox units */
const CARGO_BOX = {
  box: { x: 12, y: 22, w: 102, h: 44 },
  reefer: { x: 12, y: 22, w: 102, h: 44 },
  van: { x: 20, y: 26, w: 100, h: 40 },
  trailer: { x: 8, y: 20, w: 108, h: 46 },
  flatbed: { x: 12, y: 54, w: 104, h: 10 },
  moto: null,
};

export default function VehicleArt({
  type,
  height = 76,
  muted = false,
  load = null,        // 0..1 — omit for no load overlay
  className,
  style,
}) {
  const v = variantFor(type);
  const uid = `va-${v}-${Math.random().toString(36).slice(2, 8)}`;

  const c = {
    body: muted ? "var(--surface-sunk)" : "var(--surface)",
    line: muted ? "var(--line)" : "var(--line-strong)",
    cab: muted ? "var(--n-400, #93a1bd)" : "var(--accent)",
    stripe: muted ? "var(--line-strong)" : "var(--accent)",
    glass: muted ? "var(--surface-2)" : "var(--accent-soft)",
    tire: "var(--n-800, #212b42)",
    rim: muted ? "var(--n-400, #93a1bd)" : "var(--n-300, #c2cfe4)",
    shadow: "rgba(12, 26, 56, .10)",
  };

  // over-capacity turns the fill red, near-full amber
  const pct = load == null ? null : Math.max(0, Math.min(1.2, load));
  const loadColor =
    pct == null ? null : pct > 1 ? "var(--danger)" : pct >= 0.9 ? "var(--warn)" : "var(--accent)";

  const box = CARGO_BOX[v];
  const LoadFill = () => {
    if (pct == null || !box) return null;
    const w = Math.min(1, pct) * box.w;
    return (
      <g>
        <clipPath id={uid}>
          <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="4" />
        </clipPath>
        <g clipPath={`url(#${uid})`}>
          <rect x={box.x} y={box.y} width={w} height={box.h} fill={loadColor} opacity=".8" />
          <rect x={box.x + w - 2} y={box.y} width="2" height={box.h} fill={loadColor} />
        </g>
      </g>
    );
  };

  const Wheel = ({ cx }) => (
    <g>
      <circle cx={cx} cy={76} r="12.5" fill={c.tire} />
      <circle cx={cx} cy={76} r="5" fill={c.rim} />
    </g>
  );

  const Cab = () => (
    <g>
      <path d="M120 27 h30 a5 5 0 0 1 4 2 l12 17 h20 a6 6 0 0 1 6 6 v16 h-72 z" fill={c.cab} />
      <path d="M151 31 h4 l11 15 h-15 z" fill={c.glass} />
      <rect x="124" y="31" width="21" height="15" rx="3" fill={c.glass} />
      <rect x="181" y="54" width="7" height="5" rx="2" fill={c.glass} />
    </g>
  );

  const Chassis = ({ x = 10, w = 180 }) => (
    <rect x={x} y={66} width={w} height="6" rx="2" fill={c.line} />
  );

  const svgProps = { viewBox: "0 0 200 96", height, className, style, role: "img", "aria-label": type || "Vehicle" };

  if (v === "moto") {
    return (
      <svg {...svgProps}>
        <ellipse cx="100" cy="89" rx="62" ry="4.5" fill={c.shadow} />
        <path d="M62 74 l16 -22 h30 l10 12" fill="none" stroke={c.cab} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M108 52 l14 -10 h12" fill="none" stroke={c.line} strokeWidth="5" strokeLinecap="round" />
        <path d="M78 52 q14 -14 30 0" fill={c.body} stroke={c.line} strokeWidth="2" />
        <circle cx="62" cy="74" r="14" fill="none" stroke={c.tire} strokeWidth="5" />
        <circle cx="134" cy="74" r="14" fill="none" stroke={c.tire} strokeWidth="5" />
      </svg>
    );
  }

  if (v === "flatbed") {
    return (
      <svg {...svgProps}>
        <ellipse cx="100" cy="89" rx="86" ry="4.5" fill={c.shadow} />
        <rect x="12" y="54" width="104" height="10" rx="3" fill={c.body} stroke={c.line} strokeWidth="2" />
        <LoadFill />
        <rect x="12" y="54" width="104" height="10" rx="3" fill="none" stroke={c.line} strokeWidth="2" />
        <rect x="110" y="30" width="8" height="24" rx="2" fill={c.body} stroke={c.line} strokeWidth="2" />
        <Chassis />
        <Cab />
        <Wheel cx={44} />
        <Wheel cx={156} />
      </svg>
    );
  }

  if (v === "trailer") {
    return (
      <svg {...svgProps}>
        <ellipse cx="100" cy="89" rx="90" ry="4.5" fill={c.shadow} />
        <rect x="8" y="20" width="108" height="46" rx="4" fill={c.body} stroke={c.line} strokeWidth="2" />
        <LoadFill />
        <rect x="8" y="20" width="108" height="46" rx="4" fill="none" stroke={c.line} strokeWidth="2" />
        <rect x="8" y="24" width="108" height="5" fill={c.stripe} opacity=".45" />
        <line x1="62" y1="24" x2="62" y2="62" stroke={c.line} strokeWidth="1.5" />
        <Chassis x={8} w={182} />
        <Cab />
        <Wheel cx={30} />
        <Wheel cx={58} />
        <Wheel cx={160} />
      </svg>
    );
  }

  if (v === "reefer") {
    return (
      <svg {...svgProps}>
        <ellipse cx="100" cy="89" rx="86" ry="4.5" fill={c.shadow} />
        <rect x="12" y="22" width="102" height="44" rx="4" fill={c.body} stroke={c.line} strokeWidth="2" />
        <LoadFill />
        <rect x="12" y="22" width="102" height="44" rx="4" fill="none" stroke={c.line} strokeWidth="2" />
        <rect x="94" y="13" width="20" height="12" rx="3" fill={c.cab} />
        <line x1="98" y1="16" x2="98" y2="22" stroke={c.glass} strokeWidth="2" strokeLinecap="round" />
        <line x1="104" y1="16" x2="104" y2="22" stroke={c.glass} strokeWidth="2" strokeLinecap="round" />
        <line x1="110" y1="16" x2="110" y2="22" stroke={c.glass} strokeWidth="2" strokeLinecap="round" />
        <rect x="12" y="27" width="102" height="5" fill={c.stripe} opacity=".45" />
        <Chassis />
        <Cab />
        <Wheel cx={44} />
        <Wheel cx={156} />
      </svg>
    );
  }

  if (v === "van") {
    return (
      <svg {...svgProps}>
        <ellipse cx="100" cy="89" rx="82" ry="4.5" fill={c.shadow} />
        <path
          d="M20 26 h106 a6 6 0 0 1 5 3 l16 20 h22 a6 6 0 0 1 6 6 v11 h-155 a6 6 0 0 1 -6 -6 v-28 a6 6 0 0 1 6 -6 z"
          fill={c.body} stroke={c.line} strokeWidth="2"
        />
        <LoadFill />
        <path
          d="M20 26 h106 a6 6 0 0 1 5 3 l16 20 h22 a6 6 0 0 1 6 6 v11 h-155 a6 6 0 0 1 -6 -6 v-28 a6 6 0 0 1 6 -6 z"
          fill="none" stroke={c.line} strokeWidth="2"
        />
        <rect x="20" y="31" width="100" height="5" fill={c.stripe} opacity=".45" />
        <path d="M128 31 h4 l12 16 h-16 z" fill={c.glass} />
        <rect x="104" y="31" width="18" height="16" rx="3" fill={c.glass} />
        <Wheel cx={52} />
        <Wheel cx={158} />
      </svg>
    );
  }

  return (
    <svg {...svgProps}>
      <ellipse cx="100" cy="89" rx="86" ry="4.5" fill={c.shadow} />
      <rect x="12" y="22" width="102" height="44" rx="4" fill={c.body} stroke={c.line} strokeWidth="2" />
      <LoadFill />
      <rect x="12" y="22" width="102" height="44" rx="4" fill="none" stroke={c.line} strokeWidth="2" />
      <rect x="12" y="27" width="102" height="5" fill={c.stripe} opacity=".45" />
      <line x1="42" y1="35" x2="42" y2="61" stroke={c.line} strokeWidth="1.5" />
      <line x1="84" y1="35" x2="84" y2="61" stroke={c.line} strokeWidth="1.5" />
      <Chassis />
      <Cab />
      <Wheel cx={44} />
      <Wheel cx={156} />
    </svg>
  );
}
