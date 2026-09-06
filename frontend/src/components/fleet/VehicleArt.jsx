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
  animated = false,   // rolling wheels + road, for units that are actually moving
  className,
  style,
}) {
  const v = variantFor(type);
  // stable across re-renders — a random id would re-key the gradients every paint
  const uid = `va${useId().replace(/:/g, "")}`;
  const g = (n) => `${uid}-${n}`;

  const c = {
    line: muted ? "var(--line)" : "var(--line-strong)",
    seam: muted ? "var(--n-200, #d8e1ef)" : "var(--n-300, #c2cfe4)",
    skirt: muted ? "var(--n-200, #d8e1ef)" : "var(--n-300, #c2cfe4)",
    cab: muted ? "var(--n-400, #93a1bd)" : "var(--accent)",
    cabDark: muted ? "var(--n-500, #66728f)" : "var(--accent-strong, #1c44ac)",
    chrome: muted ? "var(--n-400, #93a1bd)" : "var(--n-500, #66728f)",
    lamp: muted ? "var(--n-300, #c2cfe4)" : "var(--warn, #d08700)",
    shadow: "rgba(12, 26, 56, .13)",
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
        <clipPath id={g("clip")}>
          <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={rx} />
        </clipPath>
        <g clipPath={`url(#${g("clip")})`}>
          <rect x={box.x} y={box.y} width={w} height={box.h} fill={loadColor} opacity=".78" />
          <rect x={box.x + w - 2} y={box.y} width="2" height={box.h} fill={loadColor} />
        </g>
      </g>
    );
  };

  /** shared gradients — body panels catch light at the top, tyres at the edge */
  const Defs = () => (
    <defs>
      <linearGradient id={g("body")} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={muted ? "var(--surface-2)" : "var(--n-0, #fff)"} />
        <stop offset="55%" stopColor={muted ? "var(--surface-sunk)" : "var(--n-25, #f7f9fd)"} />
        <stop offset="100%" stopColor={muted ? "var(--n-200, #d8e1ef)" : "var(--n-100, #e7edf6)"} />
      </linearGradient>
      <linearGradient id={g("cab")} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={c.cab} />
        <stop offset="100%" stopColor={c.cabDark} />
      </linearGradient>
      <linearGradient id={g("glass")} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={muted ? "var(--n-100, #e7edf6)" : "var(--n-200, #d8e1ef)"} />
        <stop offset="60%" stopColor={muted ? "var(--n-200, #d8e1ef)" : "var(--n-400, #93a1bd)"} />
      </linearGradient>
      <linearGradient id={g("tire")} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--n-700, #36415d)" />
        <stop offset="100%" stopColor="var(--n-950, #0b1120)" />
      </linearGradient>
      <linearGradient id={g("rim")} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--n-100, #e7edf6)" />
        <stop offset="100%" stopColor="var(--n-400, #93a1bd)" />
      </linearGradient>
    </defs>
  );

  /** tyre wall, tread notches, spoked alloy and hub — turns when animated */
  const Wheel = ({ cx, r = 13 }) => {
    const spokeR = r * 0.44;
    return (
      <g>
        <circle cx={cx} cy={76} r={r} fill={`url(#${g("tire")})`} />
        {/* tread blocks around the carcass */}
        <g opacity=".55">
          {Array.from({ length: 16 }, (_, i) => i * 22.5).map((a) => {
            const rad = (a * Math.PI) / 180;
            return (
              <line
                key={a}
                x1={cx + Math.cos(rad) * (r - 2.4)} y1={76 + Math.sin(rad) * (r - 2.4)}
                x2={cx + Math.cos(rad) * r} y2={76 + Math.sin(rad) * r}
                stroke="var(--n-950, #0b1120)" strokeWidth="1.1"
              />
            );
          })}
        </g>
        <circle cx={cx} cy={76} r={r - 1.2} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="1" />
        <g>
          {animated && (
            <animateTransform attributeName="transform" type="rotate"
              from={`0 ${cx} 76`} to={`360 ${cx} 76`} dur="1.1s" repeatCount="indefinite" />
          )}
          <circle cx={cx} cy={76} r={r * 0.62} fill={`url(#${g("rim")})`} />
          <circle cx={cx} cy={76} r={r * 0.62} fill="none" stroke="var(--n-500, #66728f)" strokeWidth=".7" />
          {/* alloy spokes */}
          {[0, 60, 120, 180, 240, 300].map((a) => {
            const rad = (a * Math.PI) / 180;
            return (
              <line
                key={a}
                x1={cx + Math.cos(rad) * (r * 0.2)} y1={76 + Math.sin(rad) * (r * 0.2)}
                x2={cx + Math.cos(rad) * spokeR} y2={76 + Math.sin(rad) * spokeR}
                stroke="var(--n-500, #66728f)" strokeWidth="1.6" strokeLinecap="round"
              />
            );
          })}
          <circle cx={cx} cy={76} r={r * 0.2} fill="var(--n-600, #4c5878)" />
          <circle cx={cx} cy={76} r={r * 0.09} fill="var(--n-300, #c2cfe4)" />
        </g>
      </g>
    );
  };

  /** long-nose cab: deflector, glass, mirror, grille, lamp, bumper, tank, stack */
  const Cab = () => (
    <g>
      <rect x="116" y="30" width="3" height="30" rx="1.5" fill={c.chrome} />
      <path d="M120 27 h30 a5 5 0 0 1 4 2 l12 17 h20 a6 6 0 0 1 6 6 v16 h-72 z" fill={`url(#${g("cab")})`} />
      <rect x="121" y="22" width="30" height="6" rx="3" fill={c.cab} />
      <path d="M151 31 h4 l11 15 h-15 z" fill={`url(#${g("glass")})`} />
      <path d="M151 31 h2 l7 10 h-9 z" fill="#fff" opacity=".22" />
      <rect x="124" y="31" width="21" height="15" rx="3" fill={`url(#${g("glass")})`} />
      <rect x="126" y="33" width="8" height="11" rx="2" fill="#fff" opacity=".18" />
      <line x1="148" y1="30" x2="148" y2="68" stroke={c.cabDark} strokeWidth="1" opacity=".55" />
      <rect x="140" y="50" width="6" height="1.8" rx=".9" fill={c.cabDark} opacity=".8" />
      <path d="M152 29 h5" stroke={c.chrome} strokeWidth="1.2" strokeLinecap="round" />
      <rect x="156" y="26" width="2.6" height="8" rx="1.2" fill={c.chrome} />
      <rect x="122" y="56" width="18" height="9" rx="3" fill={c.chrome} opacity=".55" />
      {[50, 54, 58].map((y) => (
        <line key={y} x1="170" y1={y} x2="186" y2={y} stroke={c.cabDark} strokeWidth="1" opacity=".45" />
      ))}
      <rect x="181" y="52" width="8" height="5" rx="1.6" fill={c.lamp} />
      <rect x="166" y="62" width="26" height="6" rx="2" fill={c.cabDark} />
      <rect x="150" y="64" width="11" height="3" rx="1.2" fill={c.cabDark} opacity=".7" />
    </g>
  );

  /** short day cab for the articulated variants */
  const TractorCab = () => (
    <g>
      <rect x="124" y="28" width="3" height="32" rx="1.5" fill={c.chrome} />
      <path d="M126 24 h34 a5 5 0 0 1 4 2 l14 20 h12 a6 6 0 0 1 6 6 v14 h-70 z" fill={`url(#${g("cab")})`} />
      <rect x="127" y="19" width="34" height="6" rx="3" fill={c.cab} />
      <path d="M161 28 h4 l12 17 h-16 z" fill={`url(#${g("glass")})`} />
      <path d="M161 28 h2 l8 11 h-10 z" fill="#fff" opacity=".22" />
      <rect x="130" y="28" width="25" height="17" rx="3" fill={`url(#${g("glass")})`} />
      <rect x="132" y="30" width="9" height="13" rx="2" fill="#fff" opacity=".18" />
      <line x1="158" y1="27" x2="158" y2="66" stroke={c.cabDark} strokeWidth="1" opacity=".55" />
      <rect x="149" y="48" width="6" height="1.8" rx=".9" fill={c.cabDark} opacity=".8" />
      <path d="M162 26 h5" stroke={c.chrome} strokeWidth="1.2" strokeLinecap="round" />
      <rect x="166" y="23" width="2.6" height="8" rx="1.2" fill={c.chrome} />
      <rect x="128" y="54" width="18" height="9" rx="3" fill={c.chrome} opacity=".55" />
      <rect x="184" y="52" width="7" height="5" rx="1.6" fill={c.lamp} />
      <rect x="176" y="60" width="16" height="6" rx="2" fill={c.cabDark} />
    </g>
  );

  const Chassis = ({ x = 10, w = 180 }) => (
    <g>
      <rect x={x} y={66} width={w} height="6" rx="2" fill={c.skirt} />
      <rect x={x} y={66} width={w} height="2" fill="#fff" opacity=".35" />
    </g>
  );

  const Ground = ({ rx = 86 }) => (
    <g>
      <ellipse cx="100" cy="89" rx={rx} ry="4.5" fill={c.shadow} />
      {animated && (
        <g stroke={c.seam} strokeWidth="2" strokeLinecap="round" opacity=".7">
          <line x1="0" y1="93" x2="26" y2="93">
            <animate attributeName="x1" values="200;-30" dur="0.9s" repeatCount="indefinite" />
            <animate attributeName="x2" values="226;-4" dur="0.9s" repeatCount="indefinite" />
          </line>
          <line x1="0" y1="93" x2="26" y2="93">
            <animate attributeName="x1" values="120;-110" dur="0.9s" repeatCount="indefinite" />
            <animate attributeName="x2" values="146;-84" dur="0.9s" repeatCount="indefinite" />
          </line>
        </g>
      )}
    </g>
  );

  /** rear doors, roof rail, side ribs and the lower skirt of a dry box */
  const BoxDetail = ({ x, y, w, h }) => (
    <g>
      <rect x={x} y={y + 2} width={w} height="3.5" fill="#fff" opacity=".5" />
      <rect x={x} y={y + h - 7} width={w} height="7" fill={c.skirt} opacity=".45" />
      <line x1={x + 3} y1={y + 8} x2={x + 3} y2={y + h - 8} stroke={c.seam} strokeWidth="1.4" />
      <line x1={x + w * 0.5} y1={y + 8} x2={x + w * 0.5} y2={y + h - 8} stroke={c.seam} strokeWidth="1" />
      {[0.22, 0.34, 0.66, 0.78].map((p) => (
        <line key={p} x1={x + w * p} y1={y + 9} x2={x + w * p} y2={y + h - 9} stroke={c.seam} strokeWidth=".7" opacity=".7" />
      ))}
      <rect x={x + 1.5} y={y + h * 0.4} width="2.5" height="5" rx="1" fill={c.chrome} />
      <rect x={x + 1} y={y + h - 12} width="4" height="3" rx="1" fill={c.lamp} opacity=".85" />
    </g>
  );

  const svgProps = {
    viewBox: "0 0 200 96",
    height,
    className: [className, animated ? "tk-rolling" : ""].filter(Boolean).join(" ") || undefined,
    style,
    role: "img",
    "aria-label": type || "Vehicle",
  };

  if (v === "moto") {
    return (
      <svg {...svgProps}>
        <Defs />
        <Ground rx={62} />
        <path d="M62 74 l16 -22 h30 l10 12" fill="none" stroke={c.cab} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M108 52 l14 -10 h12" fill="none" stroke={c.chrome} strokeWidth="5" strokeLinecap="round" />
        <path d="M78 52 q14 -14 30 0" fill={`url(#${g("body")})`} stroke={c.line} strokeWidth="2" />
        <circle cx="62" cy="74" r="14" fill="none" stroke="var(--n-900, #121a2e)" strokeWidth="5" />
        <circle cx="134" cy="74" r="14" fill="none" stroke="var(--n-900, #121a2e)" strokeWidth="5" />
        <circle cx="62" cy="74" r="5" fill={`url(#${g("rim")})`} />
        <circle cx="134" cy="74" r="5" fill={`url(#${g("rim")})`} />
      </svg>
    );
  }

  if (v === "pickup") {
    return (
      <svg {...svgProps}>
        <Defs />
        <Ground rx={74} />
        <rect x="14" y="46" width="80" height="20" rx="2" fill={`url(#${g("body")})`} stroke={c.line} strokeWidth="1.6" />
        <LoadFill rx={2} />
        <rect x="14" y="46" width="80" height="20" rx="2" fill="none" stroke={c.line} strokeWidth="1.6" />
        <rect x="14" y="47" width="80" height="2.5" fill="#fff" opacity=".5" />
        <line x1="44" y1="50" x2="44" y2="63" stroke={c.seam} strokeWidth=".8" />
        <line x1="70" y1="50" x2="70" y2="63" stroke={c.seam} strokeWidth=".8" />
        <rect x="13" y="55" width="3" height="4" rx="1" fill={c.lamp} opacity=".85" />
        <rect x="14" y="66" width="140" height="5" rx="2" fill={c.skirt} />
        <path d="M92 66 v-30 a4 4 0 0 1 4 -4 h30 a5 5 0 0 1 4 2 l12 14 h10 a4 4 0 0 1 4 4 v14 z" fill={`url(#${g("cab")})`} />
        <rect x="98" y="36" width="24" height="13" rx="2.5" fill={`url(#${g("glass")})`} />
        <rect x="100" y="38" width="9" height="9" rx="1.5" fill="#fff" opacity=".2" />
        <path d="M126 36 h3 l10 12 h-13 z" fill={`url(#${g("glass")})`} />
        <line x1="123" y1="35" x2="123" y2="66" stroke={c.cabDark} strokeWidth="1" opacity=".5" />
        <rect x="116" y="52" width="5" height="1.6" rx=".8" fill={c.cabDark} opacity=".8" />
        <rect x="147" y="52" width="7" height="4.5" rx="1.5" fill={c.lamp} />
        <rect x="139" y="61" width="17" height="5" rx="2" fill={c.cabDark} />
        <Wheel cx={42} r={12} />
        <Wheel cx={132} r={12} />
      </svg>
    );
  }

  if (v === "flatbed") {
    return (
      <svg {...svgProps}>
        <Defs />
        <Ground />
        <rect x="12" y="54" width="104" height="10" rx="2" fill={`url(#${g("body")})`} stroke={c.line} strokeWidth="1.6" />
        <LoadFill rx={2} />
        <rect x="12" y="54" width="104" height="10" rx="2" fill="none" stroke={c.line} strokeWidth="1.6" />
        <rect x="12" y="55" width="104" height="2" fill="#fff" opacity=".5" />
        {[28, 50, 72, 94].map((x) => (
          <rect key={x} x={x} y="48" width="2.5" height="6" rx="1" fill={c.chrome} />
        ))}
        <rect x="110" y="28" width="8" height="26" rx="2" fill={`url(#${g("body")})`} stroke={c.line} strokeWidth="1.6" />
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
        <Defs />
        <Ground rx={90} />
        <rect x="8" y="20" width="120" height="46" rx="3" fill={`url(#${g("body")})`} stroke={c.line} strokeWidth="1.6" />
        <LoadFill />
        <rect x="8" y="20" width="120" height="46" rx="3" fill="none" stroke={c.line} strokeWidth="1.6" />
        <BoxDetail x={8} y={20} w={120} h={46} />
        <rect x="96" y="66" width="4" height="10" rx="1" fill={c.chrome} />
        <rect x="18" y="66" width="90" height="4" rx="1.5" fill={c.skirt} opacity=".7" />
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
        <Defs />
        <Ground rx={90} />
        <rect x="8" y="24" width="110" height="40" fill={`url(#${g("body")})`} stroke={c.line} strokeWidth="1.6" />
        <LoadFill rx={1} />
        <rect x="8" y="24" width="110" height="40" fill="none" stroke={c.line} strokeWidth="1.6" />
        <rect x="8" y="25" width="110" height="2.5" fill="#fff" opacity=".5" />
        {Array.from({ length: 14 }, (_, i) => 14 + i * 7).map((x) => (
          <line key={x} x1={x} y1="30" x2={x} y2="58" stroke={c.seam} strokeWidth="1.6" opacity=".75" />
        ))}
        {[[8, 24], [110, 24], [8, 58], [110, 58]].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="8" height="6" fill={c.chrome} />
        ))}
        <rect x="118" y="58" width="14" height="8" rx="2" fill={c.chrome} />
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
        <Defs />
        <Ground rx={88} />
        <rect x="10" y="26" width="108" height="38" rx="19" fill={`url(#${g("body")})`} stroke={c.line} strokeWidth="1.6" />
        <LoadFill rx={19} />
        <rect x="10" y="26" width="108" height="38" rx="19" fill="none" stroke={c.line} strokeWidth="1.6" />
        <path d="M20 32 a30 14 0 0 1 88 0" fill="#fff" opacity=".45" />
        <path d="M28 27 a19 19 0 0 0 0 36" fill="none" stroke={c.seam} strokeWidth="1.3" />
        <path d="M100 27 a19 19 0 0 1 0 36" fill="none" stroke={c.seam} strokeWidth="1.3" />
        <path d="M64 26 a19 19 0 0 1 0 38" fill="none" stroke={c.seam} strokeWidth=".9" opacity=".7" />
        <rect x="44" y="20" width="13" height="7" rx="2" fill={c.chrome} />
        <rect x="72" y="20" width="13" height="7" rx="2" fill={c.chrome} />
        <rect x="18" y="58" width="90" height="7" rx="3" fill={c.skirt} opacity=".7" />
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
        <Defs />
        <Ground />
        <rect x="12" y="22" width="102" height="44" rx="3" fill={`url(#${g("body")})`} stroke={c.line} strokeWidth="1.6" />
        <LoadFill />
        <rect x="12" y="22" width="102" height="44" rx="3" fill="none" stroke={c.line} strokeWidth="1.6" />
        <BoxDetail x={12} y={22} w={102} h={44} />
        {/* the roof-mounted refrigeration unit */}
        <rect x="92" y="11" width="22" height="14" rx="3" fill={`url(#${g("cab")})`} />
        <rect x="94.5" y="13.5" width="17" height="6" rx="1.5" fill={`url(#${g("glass")})`} opacity=".8" />
        {[97, 103, 109].map((x) => (
          <line key={x} x1={x} y1="21" x2={x} y2="25" stroke={c.chrome} strokeWidth="1.4" strokeLinecap="round" />
        ))}
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
        <Defs />
        <Ground />
        {/* the side panel hinged up along the roof line */}
        <path d="M114 21 L18 11 L18 5 L114 15 Z" fill={`url(#${g("cab")})`} />
        <path d="M114 15 L18 5 L18 7 L114 17 Z" fill="#fff" opacity=".25" />
        <rect x="12" y="22" width="102" height="44" rx="3" fill={`url(#${g("body")})`} stroke={c.line} strokeWidth="1.6" />
        <LoadFill />
        <rect x="12" y="22" width="102" height="44" rx="3" fill="none" stroke={c.line} strokeWidth="1.6" />
        <BoxDetail x={12} y={22} w={102} h={44} />
        <line x1="12" y1="30" x2="114" y2="30" stroke={c.seam} strokeWidth="1.4" />
        <Chassis />
        <Cab />
        <Wheel cx={44} />
        <Wheel cx={156} />
      </svg>
    );
  }

  if (v === "van") {
    const shell =
      "M20 26 h106 a6 6 0 0 1 5 3 l16 20 h22 a6 6 0 0 1 6 6 v11 h-155 a6 6 0 0 1 -6 -6 v-28 a6 6 0 0 1 6 -6 z";
    return (
      <svg {...svgProps}>
        <Defs />
        <Ground rx={82} />
        <path d={shell} fill={`url(#${g("body")})`} stroke={c.line} strokeWidth="1.6" />
        <LoadFill />
        <path d={shell} fill="none" stroke={c.line} strokeWidth="1.6" />
        <path d="M22 27 h104 l2 2 h-106 z" fill="#fff" opacity=".5" />
        <rect x="20" y="58" width="126" height="7" fill={c.skirt} opacity=".4" />
        <line x1="60" y1="32" x2="60" y2="58" stroke={c.seam} strokeWidth="1.2" />
        <line x1="100" y1="32" x2="100" y2="58" stroke={c.seam} strokeWidth="1.2" />
        <rect x="21" y="40" width="2.5" height="5" rx="1" fill={c.chrome} />
        <rect x="20" y="50" width="4" height="4" rx="1" fill={c.lamp} opacity=".85" />
        <path d="M128 31 h4 l12 16 h-16 z" fill={`url(#${g("glass")})`} />
        <path d="M128 31 h2 l8 11 h-10 z" fill="#fff" opacity=".22" />
        <rect x="104" y="31" width="18" height="16" rx="3" fill={`url(#${g("glass")})`} />
        <rect x="106" y="33" width="7" height="12" rx="1.5" fill="#fff" opacity=".2" />
        <path d="M129 30 h5" stroke={c.chrome} strokeWidth="1.2" strokeLinecap="round" />
        <rect x="133" y="27" width="2.4" height="7" rx="1.2" fill={c.chrome} />
        <rect x="163" y="52" width="8" height="5" rx="1.6" fill={c.lamp} />
        <rect x="146" y="61" width="27" height="5" rx="2" fill={c.skirt} />
        <Wheel cx={52} r={12} />
        <Wheel cx={158} r={12} />
      </svg>
    );
  }

  return (
    <svg {...svgProps}>
      <Defs />
      <Ground />
      <rect x="12" y="22" width="102" height="44" rx="3" fill={`url(#${g("body")})`} stroke={c.line} strokeWidth="1.6" />
      <LoadFill />
      <rect x="12" y="22" width="102" height="44" rx="3" fill="none" stroke={c.line} strokeWidth="1.6" />
      <BoxDetail x={12} y={22} w={102} h={44} />
      <Chassis />
      <Cab />
      <Wheel cx={44} />
      <Wheel cx={156} />
    </svg>
  );
}
