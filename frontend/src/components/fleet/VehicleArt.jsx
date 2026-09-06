import { useId } from "react";

/**
 * Side-profile vehicle illustrations, drawn inline as SVG so they scale, theme
 * with the design tokens (light/dark), and need no image assets.
 *
 * The silhouette is chosen from the vehicle's own `type` field — the same
 * string the fleet record stores — so a Closed Van never renders as a semi.
 * Nothing here is inferred: an unknown type falls back to the generic box
 * truck rather than guessing from brand or model.
 *
 * `load` (0..1) paints a proportional load-level fill inside the cargo body,
 * so a unit reads as "how full is it" at a glance.
 */

const VARIANTS = {
  "Closed Van": "van",
  Van: "van",
  "Box Truck": "box",
  "Furniture Truck": "box",
  "Wing Van": "wing",
  "Refrigerated Van": "reefer",
  "Reefer Truck": "reefer",
  "Flatbed Truck": "flatbed",
  Flatbed: "flatbed",
  Trailer: "tractor",
  "Tractor Trailer": "tractor",
  "Container Truck": "container",
  Tanker: "tanker",
  "Tanker Truck": "tanker",
  Pickup: "pickup",
  "Pickup Truck": "pickup",
  Motorcycle: "moto",
};

export function variantFor(type) {
  return VARIANTS[type] || "box";
}

/** the fillable cargo region per variant, in viewBox units */
const CARGO_BOX = {
  box: { x: 12, y: 22, w: 102, h: 44 },
  wing: { x: 12, y: 22, w: 102, h: 44 },
  reefer: { x: 12, y: 22, w: 102, h: 44 },
  van: { x: 20, y: 26, w: 100, h: 40 },
  tractor: { x: 8, y: 20, w: 120, h: 46 },
  container: { x: 8, y: 24, w: 110, h: 40 },
  tanker: { x: 10, y: 26, w: 108, h: 38 },
  flatbed: { x: 12, y: 54, w: 104, h: 10 },
  pickup: { x: 14, y: 46, w: 80, h: 20 },
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
  // stable across re-renders — a random id would re-key the clipPath every paint
  const uid = `va${useId().replace(/:/g, "")}`;

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
  const LoadFill = ({ rx = 4 }) => {
    if (pct == null || !box) return null;
    const w = Math.min(1, pct) * box.w;
    return (
      <g>
        <clipPath id={uid}>
          <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={rx} />
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

  /** short day cab — used by the articulated variants */
  const TractorCab = () => (
    <g>
      <path d="M126 24 h34 a5 5 0 0 1 4 2 l14 20 h12 a6 6 0 0 1 6 6 v14 h-70 z" fill={c.cab} />
      <path d="M161 28 h4 l12 17 h-16 z" fill={c.glass} />
      <rect x="130" y="28" width="25" height="17" rx="3" fill={c.glass} />
      <rect x="184" y="54" width="7" height="5" rx="2" fill={c.glass} />
    </g>
  );

  const Chassis = ({ x = 10, w = 180 }) => (
    <rect x={x} y={66} width={w} height="6" rx="2" fill={c.line} />
  );

  const Ground = ({ rx = 86 }) => <ellipse cx="100" cy="89" rx={rx} ry="4.5" fill={c.shadow} />;

  const svgProps = { viewBox: "0 0 200 96", height, className, style, role: "img", "aria-label": type || "Vehicle" };

  if (v === "moto") {
    return (
      <svg {...svgProps}>
        <Ground rx={62} />
        <path d="M62 74 l16 -22 h30 l10 12" fill="none" stroke={c.cab} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M108 52 l14 -10 h12" fill="none" stroke={c.line} strokeWidth="5" strokeLinecap="round" />
        <path d="M78 52 q14 -14 30 0" fill={c.body} stroke={c.line} strokeWidth="2" />
        <circle cx="62" cy="74" r="14" fill="none" stroke={c.tire} strokeWidth="5" />
        <circle cx="134" cy="74" r="14" fill="none" stroke={c.tire} strokeWidth="5" />
      </svg>
    );
  }

  if (v === "pickup") {
    return (
      <svg {...svgProps}>
        <Ground rx={74} />
        {/* open bed */}
        <rect x="14" y="46" width="80" height="20" rx="2" fill={c.body} stroke={c.line} strokeWidth="2" />
        <LoadFill rx={2} />
        <rect x="14" y="46" width="80" height="20" rx="2" fill="none" stroke={c.line} strokeWidth="2" />
        <rect x="14" y="66" width="140" height="5" rx="2" fill={c.line} />
        {/* crew cab + hood */}
        <path d="M92 66 v-30 a4 4 0 0 1 4 -4 h30 a5 5 0 0 1 4 2 l12 14 h10 a4 4 0 0 1 4 4 v14 z" fill={c.cab} />
        <rect x="98" y="36" width="24" height="13" rx="2.5" fill={c.glass} />
        <path d="M126 36 h3 l10 12 h-13 z" fill={c.glass} />
        <rect x="149" y="54" width="6" height="4.5" rx="2" fill={c.glass} />
        <Wheel cx={42} />
        <Wheel cx={132} />
      </svg>
    );
  }

  if (v === "flatbed") {
    return (
      <svg {...svgProps}>
        <Ground />
        <rect x="12" y="54" width="104" height="10" rx="3" fill={c.body} stroke={c.line} strokeWidth="2" />
        <LoadFill rx={3} />
        <rect x="12" y="54" width="104" height="10" rx="3" fill="none" stroke={c.line} strokeWidth="2" />
        <rect x="110" y="30" width="8" height="24" rx="2" fill={c.body} stroke={c.line} strokeWidth="2" />
        <Chassis />
        <Cab />
        <Wheel cx={44} />
        <Wheel cx={156} />
      </svg>
    );
  }

  if (v === "tractor") {
    return (
      <svg {...svgProps}>
        <Ground rx={90} />
        <rect x="8" y="20" width="120" height="46" rx="4" fill={c.body} stroke={c.line} strokeWidth="2" />
        <LoadFill />
        <rect x="8" y="20" width="120" height="46" rx="4" fill="none" stroke={c.line} strokeWidth="2" />
        <rect x="8" y="24" width="120" height="5" fill={c.stripe} opacity=".45" />
        <line x1="62" y1="24" x2="62" y2="62" stroke={c.line} strokeWidth="1.5" />
        {/* landing gear + fifth-wheel coupling — the articulation tell */}
        <rect x="100" y="66" width="4" height="10" rx="1" fill={c.line} />
        <Chassis x={8} w={182} />
        <TractorCab />
        <Wheel cx={30} />
        <Wheel cx={56} />
        <Wheel cx={150} />
        <Wheel cx={182} />
      </svg>
    );
  }

  if (v === "container") {
    return (
      <svg {...svgProps}>
        <Ground rx={90} />
        {/* skeletal chassis carrying a shipping container */}
        <rect x="8" y="24" width="110" height="40" rx="1" fill={c.body} stroke={c.line} strokeWidth="2" />
        <LoadFill rx={1} />
        <rect x="8" y="24" width="110" height="40" rx="1" fill="none" stroke={c.line} strokeWidth="2" />
        {[22, 36, 50, 64, 78, 92, 106].map((x) => (
          <line key={x} x1={x} y1="29" x2={x} y2="59" stroke={c.line} strokeWidth="1.2" opacity=".55" />
        ))}
        {/* corner castings */}
        {[[8, 24], [110, 24], [8, 58], [110, 58]].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="8" height="6" fill={c.line} />
        ))}
        <rect x="118" y="58" width="14" height="8" rx="2" fill={c.line} />
        <Chassis x={8} w={182} />
        <TractorCab />
        <Wheel cx={30} />
        <Wheel cx={56} />
        <Wheel cx={150} />
        <Wheel cx={182} />
      </svg>
    );
  }

  if (v === "tanker") {
    return (
      <svg {...svgProps}>
        <Ground rx={88} />
        <rect x="10" y="26" width="108" height="38" rx="19" fill={c.body} stroke={c.line} strokeWidth="2" />
        <LoadFill rx={19} />
        <rect x="10" y="26" width="108" height="38" rx="19" fill="none" stroke={c.line} strokeWidth="2" />
        {/* end-cap seams + filler hatches */}
        <path d="M28 27 a19 19 0 0 0 0 36" fill="none" stroke={c.line} strokeWidth="1.5" opacity=".7" />
        <path d="M100 27 a19 19 0 0 1 0 36" fill="none" stroke={c.line} strokeWidth="1.5" opacity=".7" />
        <rect x="44" y="20" width="13" height="7" rx="2" fill={c.cab} />
        <rect x="72" y="20" width="13" height="7" rx="2" fill={c.cab} />
        <rect x="18" y="60" width="90" height="6" rx="2" fill={c.line} opacity=".6" />
        <Chassis />
        <Cab />
        <Wheel cx={44} />
        <Wheel cx={156} />
      </svg>
    );
  }

  if (v === "reefer") {
    return (
      <svg {...svgProps}>
        <Ground />
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

  if (v === "wing") {
    return (
      <svg {...svgProps}>
        <Ground />
        {/* raised side wing — the panel that hinges up along the roof */}
        <path d="M114 21 L18 11 L18 5 L114 15 Z" fill={c.cab} opacity=".9" />
        <rect x="12" y="22" width="102" height="44" rx="4" fill={c.body} stroke={c.line} strokeWidth="2" />
        <LoadFill />
        <rect x="12" y="22" width="102" height="44" rx="4" fill="none" stroke={c.line} strokeWidth="2" />
        <line x1="12" y1="30" x2="114" y2="30" stroke={c.line} strokeWidth="1.5" />
        <line x1="63" y1="30" x2="63" y2="62" stroke={c.line} strokeWidth="1.5" />
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
        <Ground rx={82} />
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
      <Ground />
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
