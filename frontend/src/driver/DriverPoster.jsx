import "./driver-poster.css";

/**
 * The driver sign-in poster: the blue Trackify box truck as a low-poly model,
 * drawn over loose pencil construction lines on a charcoal ground. The one
 * accent is the system blue (see driver-poster.css): the lane paint, and the
 * same blue on one word of the headline.
 *
 * Still on purpose: it is a poster, not a scene. One SVG, no animation, no
 * images — it paints once and costs nothing after that.
 *
 * It stays dark in both themes, like a printed poster; the sign-in sheet over
 * it follows the driver's theme.
 *
 * Geometry is one isometric projection, so the faces, the lettering and the
 * wheels all line up: l runs along the truck (towards its front, down and to
 * the right), w across it (away from the viewer, up and to the right), z up.
 */

const K = 1.04; // model units → poster px
const OX = 106;
const OY = 200;
const C30 = 0.866;

const P = (l, w, z) => [OX + K * C30 * (l + w), OY + K * (0.5 * (l - w) - z)];
const pts = (...corners) => corners.map((c) => P(...c).map((n) => n.toFixed(1)).join(",")).join(" ");
/* a plane on the near side of the truck (w fixed), for things drawn flat on it */
const sideMatrix = (l, w, z, flip = false) => {
  const [x, y] = P(l, w, z);
  return `matrix(${(K * C30).toFixed(3)} ${(K * 0.5).toFixed(3)} 0 ${flip ? -K : K} ${x.toFixed(1)} ${y.toFixed(1)})`;
};
/* a straight line on the ground or the model, between two model points */
const seg = (a, b) => {
  const [x1, y1] = P(...a);
  const [x2, y2] = P(...b);
  return { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1) };
};

/** A face as two triangles of slightly different shade — the low-poly look. */
function Facet({ a, b, c, d, light, dark }) {
  return (
    <>
      <polygon points={pts(a, b, c)} fill={light} />
      <polygon points={pts(a, c, d)} fill={dark} />
    </>
  );
}

/* the truck's dimensions, in model units */
const BOX = { l0: 0, l1: 112, w0: 0, w1: 50, z0: 17, z1: 77 };
const CAB = { l0: 115, l1: 159, lr: 151, w0: 3, w1: 47, z0: 17, zb: 45, z1: 60 };
const WHEELS = [24, 50, 141];

function Truck() {
  const b = BOX;
  const c = CAB;
  return (
    <g className="dp-truck">
      {/* chassis rail, visible in the gap under the box and the cab */}
      <polygon points={pts([0, 4, 9], [162, 4, 9], [162, 4, 18], [0, 4, 18])} fill="#12161f" />

      {/* the cargo box */}
      <Facet a={[b.l0, b.w0, b.z1]} b={[b.l1, b.w0, b.z1]} c={[b.l1, b.w1, b.z1]} d={[b.l0, b.w1, b.z1]} light="#5583f2" dark="#4b79ea" />
      <Facet a={[b.l0, b.w0, b.z0]} b={[b.l1, b.w0, b.z0]} c={[b.l1, b.w0, b.z1]} d={[b.l0, b.w0, b.z1]} light="#2a59d1" dark="#3163dc" />
      <Facet a={[b.l1, b.w0, b.z0]} b={[b.l1, b.w1, b.z0]} c={[b.l1, b.w1, b.z1]} d={[b.l1, b.w0, b.z1]} light="#1f48b4" dark="#2550c0" />
      {/* panel seams on the roof */}
      <line {...seg([56, b.w0, b.z1], [56, b.w1, b.z1])} className="dp-seam" />
      <line {...seg([b.l0, b.w0, b.z1], [b.l1, b.w0, b.z1])} className="dp-edge" />

      {/* the white stripe and the name, flat on the near side */}
      <polygon points={pts([b.l0, b.w0, 26], [b.l1, b.w0, 26], [b.l1, b.w0, 31], [b.l0, b.w0, 31])} fill="#f4f6fb" />
      <text transform={sideMatrix(13, b.w0, 47)} className="dp-name">TRACKIFY</text>

      {/* the cab: roof, a raked windscreen, the front, and the near side with its window */}
      <Facet a={[c.l0, c.w0, c.z1]} b={[c.lr, c.w0, c.z1]} c={[c.lr, c.w1, c.z1]} d={[c.l0, c.w1, c.z1]} light="#6d99f6" dark="#6591f2" />
      <Facet a={[c.lr, c.w0, c.z1]} b={[c.l1, c.w0, c.zb]} c={[c.l1, c.w1, c.zb]} d={[c.lr, c.w1, c.z1]} light="#1a2947" dark="#14203a" />
      <polygon points={pts([c.lr + 1.5, c.w0 + 6, c.z1 - 2.5], [c.lr + 4, c.w0 + 6, c.z1 - 7], [c.lr + 4, c.w0 + 20, c.z1 - 7])} fill="#3b5791" opacity=".7" />
      <Facet a={[c.l1, c.w0, c.z0]} b={[c.l1, c.w1, c.z0]} c={[c.l1, c.w1, c.zb]} d={[c.l1, c.w0, c.zb]} light="#3866d3" dark="#3f6dda" />
      <polygon points={pts([c.l0, c.w0, c.z0], [c.l1, c.w0, c.z0], [c.l1, c.w0, c.zb], [c.lr, c.w0, c.z1], [c.l0, c.w0, c.z1])} fill="#4778e4" />
      <polygon points={pts([c.l0, c.w0, c.z0], [c.l1, c.w0, c.z0], [c.l1, c.w0, c.zb])} fill="#4171de" />
      <polygon points={pts([c.l0 + 7, c.w0, 42], [c.lr - 4, c.w0, 42], [c.lr - 1, c.w0, 55], [c.l0 + 7, c.w0, 55])} fill="#1a2947" />
      <line {...seg([c.l0, c.w0, c.z1], [c.lr, c.w0, c.z1])} className="dp-edge" />

      {/* front: headlights, grille, bumper */}
      <polygon points={pts([c.l1, 6, 24], [c.l1, 14, 24], [c.l1, 14, 29], [c.l1, 6, 29])} fill="#fff3d6" />
      <polygon points={pts([c.l1, 36, 24], [c.l1, 44, 24], [c.l1, 44, 29], [c.l1, 36, 29])} fill="#fff3d6" />
      {[19, 23, 27, 31].map((w) => (
        <line key={w} {...seg([c.l1, w, 22], [c.l1, w, 32])} className="dp-grille" />
      ))}
      <polygon points={pts([c.l1, c.w0, 10], [c.l1 + 3, c.w0, 10], [c.l1 + 3, c.w1, 10], [c.l1 + 3, c.w1, 18], [c.l1, c.w1, 18], [c.l1, c.w0, 18])} fill="#1b1f27" />

      {/* marker lights */}
      {[[3, 74], [109, 74], [c.l0 + 3, 57]].map(([l, z]) => {
        const [x, y] = P(l, 0, z);
        return <circle key={l} cx={x.toFixed(1)} cy={y.toFixed(1)} r="1.9" className="dp-marker" />;
      })}

      {/* wheels, as circles laid flat on the near side */}
      {WHEELS.map((l) => (
        <g key={l} transform={sideMatrix(l, -1, 11, true)}>
          <circle r="11.5" fill="#0d0f13" />
          <circle r="6" fill="#5d6675" />
          <circle r="2.6" fill="#22262e" />
        </g>
      ))}
    </g>
  );
}

/* Pencil work: lines a draughtsman leaves behind — the road's edges sketched
   twice, construction lines running past the truck's corners, hatching in its
   shadow. Roughened by the filter, so no line is quite straight. */
const ROAD = [
  { w: -66, o: 0.34 },
  { w: -63, o: 0.16 },
  { w: 122, o: 0.3 },
  { w: 125, o: 0.14 },
];
const CONSTRUCTION = [
  [[-40, 0, 77], [150, 0, 77]],
  [[-30, 50, 77], [140, 50, 77]],
  [[112, -30, 77], [112, 80, 77]],
  [[0, -26, 77], [0, 70, 77]],
  [[0, 0, -6], [0, 0, 96]],
  [[112, 0, -8], [112, 0, 98]],
  [[159, 3, -6], [159, 3, 70]],
  [[-60, 0, 17], [190, 0, 17]],
];
const HATCH = Array.from({ length: 9 }, (_, i) => 10 + i * 17);

function Sketch() {
  return (
    <g className="dp-sketch" filter="url(#dp-rough)">
      {ROAD.map((r) => (
        <line key={r.w} {...seg([-420, r.w, 0], [560, r.w, 0])} style={{ opacity: r.o }} />
      ))}
      {CONSTRUCTION.map(([a, b], i) => (
        <line key={i} {...seg(a, b)} className="dp-construct" />
      ))}
      {HATCH.map((l) => (
        <line key={l} {...seg([l, -5, 0], [l + 5, -19, 0])} className="dp-hatch" />
      ))}
      {/* the outline again, a hair off — pencil laid over the model */}
      <polygon
        points={pts([0, 0, 17], [112, 0, 17], [115, 3, 17], [159, 3, 17], [159, 3, 45], [151, 3, 60], [151, 47, 60], [115, 47, 60], [112, 50, 62], [112, 50, 77], [0, 50, 77], [0, 0, 77])}
        className="dp-outline"
        transform="translate(1.6 -1.2)"
      />
      {/* a dimension line over the box: length, with its end ticks */}
      <line {...seg([0, 60, 86], [112, 60, 86])} className="dp-construct" />
      <line {...seg([0, 60, 82], [0, 60, 90])} className="dp-construct" />
      <line {...seg([112, 60, 82], [112, 60, 90])} className="dp-construct" />
    </g>
  );
}

/* The part of the poster the truck stands in, in model space: the truck, its
   shadow and the dimension line, with a little air. The road and the pencil
   lines run on past it (overflow is visible) to the edges of the band. */
const STAGE = { x: 92, y: 66, w: 218, h: 240 };

/**
 * The ground: charcoal and grain, filling the top band behind everything.
 * Placed at the top of the sign-in screen, under the veil.
 */
export default function DriverPoster() {
  return (
    <div className="dp" aria-hidden="true">
      <svg className="dp-grain-art" width="100%" height="100%" focusable="false">
        <defs>
          {/* paper grain — the slightly rough texture of a print */}
          <filter id="dp-grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="2" />
            <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter="url(#dp-grain)" className="dp-grain" />
      </svg>
    </div>
  );
}

/**
 * The truck on its road, sized to the room between the wordmark and the
 * headline — so on a short phone it shrinks rather than sliding under the
 * words, and on a tall one it stops growing.
 */
export function PosterTruck() {
  return (
    <div className="dp-stage" aria-hidden="true">
      <svg
        className="dp-art"
        viewBox={`${STAGE.x} ${STAGE.y} ${STAGE.w} ${STAGE.h}`}
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
      >
        <defs>
          <filter id="dp-rough" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" />
          </filter>
          <filter id="dp-soft" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        {/* lane paint: one dashed line in the accent blue, one faint white one */}
        <line {...seg([-420, -30, 0], [560, -30, 0])} className="dp-lane" />
        <line {...seg([-420, 84, 0], [560, 84, 0])} className="dp-lane-faint" />

        {/* the shadow the truck stands in */}
        <polygon points={pts([-6, -16, 0], [170, -16, 0], [170, 50, 0], [-6, 50, 0])} fill="#000" opacity=".55" filter="url(#dp-soft)" />

        <Sketch />
        <Truck />
      </svg>
    </div>
  );
}
