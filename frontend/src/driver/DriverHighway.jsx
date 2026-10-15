import { useEffect, useRef, useState } from "react";
import { resolvedTheme } from "../theme/theme";
import "./driver-highway.css";

/**
 * The driver sign-in hero: an endless highway seen from above at an angle, with
 * a blue box truck holding the centre of the frame while the road, the
 * scenery and the traffic stream past it.
 *
 * It is plain DOM and CSS 3D — no canvas, no library, no images. The world is a
 * flat plane of road tilted into view; vehicles are boxes built from three
 * visible faces; trees and lamps are upright cut-outs turned to face the
 * screen. Every moving thing is a transform animation, so it runs on the
 * compositor and costs the main thread nothing once it is going.
 *
 * Axes, in scene pixels: +x is across the road, +y is the direction the truck
 * is heading, +z is up. The truck stays at the origin; everything else moves
 * along y at a speed that makes the truck look like it is doing the driving.
 */

/** How far a passing vehicle travels before it re-enters at the far end. */
const PATH = 1800;

/** Lane centres across the road (the truck drives down the middle one). */
const LANE = { slow: -64, bay: 64, near: 160, far: 224 };

/*
 * Traffic. `v` is speed *relative to the truck*: positive overtakes it,
 * negative is passed by it (oncoming traffic is a large negative). Vehicles
 * sharing a lane share a speed, so none ever runs into another; `at` is how far
 * along its path each one starts, which spreads them out on first paint.
 */
const TRAFFIC = [
  { k: "car", c: "#eef2f8", x: LANE.slow, dir: 1, v: -52, at: 0.1 },
  { k: "van", c: "#f1b73f", x: LANE.slow, dir: 1, v: -52, at: 0.46 },
  { k: "car", c: "#46556f", x: LANE.slow, dir: 1, v: -52, at: 0.8 },

  { k: "car", c: "#dc5252", x: LANE.bay, dir: 1, v: 96, at: 0.22 },
  { k: "rig", c: "#eceff5", x: LANE.bay, dir: 1, v: 96, at: 0.6 },
  { k: "car", c: "#2fae86", x: LANE.bay, dir: 1, v: 96, at: 0.9 },

  { k: "car", c: "#f3f5fa", x: LANE.near, dir: -1, v: -310, at: 0.05 },
  { k: "van", c: "#6b7da3", x: LANE.near, dir: -1, v: -310, at: 0.3 },
  { k: "car", c: "#e9a23b", x: LANE.near, dir: -1, v: -310, at: 0.55 },
  { k: "rig", c: "#d8dde8", x: LANE.near, dir: -1, v: -310, at: 0.78 },

  { k: "car", c: "#3b4a68", x: LANE.far, dir: -1, v: -262, at: 0.15 },
  { k: "car", c: "#e8edf6", x: LANE.far, dir: -1, v: -262, at: 0.5 },
  { k: "van", c: "#d95a5a", x: LANE.far, dir: -1, v: -262, at: 0.85 },
];

/* Roadside trees: a repeating run of four per column, so the strip can slide by
   one run and land exactly where it started. */
const TREE_RUN = 4;
const TREE_GAP = 130;
const TREE_COLUMNS = [
  { x: -130, jx: [0, 14, -8, 6], jy: [0, 28, -20, 12], sz: [1, 0.82, 1.1, 0.9] },
  { x: -180, jx: [10, -6, 12, -12], jy: [60, 10, 90, 36], sz: [0.9, 1.15, 0.8, 1] },
  { x: 304, jx: [0, -10, 8, -4], jy: [30, 80, 0, 52], sz: [1.1, 0.9, 1, 0.84] },
];
const TREES = TREE_COLUMNS.flatMap((col) =>
  Array.from({ length: 25 }, (_, i) => ({
    key: `${col.x}:${i}`,
    x: col.x + col.jx[i % TREE_RUN],
    y: -1400 + i * TREE_GAP + col.jy[i % TREE_RUN],
    sz: col.sz[i % TREE_RUN],
  })),
);

const LAMP_GAP = 260;
const LAMPS = Array.from({ length: 12 }, (_, i) => ({ key: i, y: -1300 + i * LAMP_GAP }));

/** The ring of speed the world runs at, in scene px per second. */
const SPEED = 192;

/* ------------------------------------------------------------------ pieces */

/**
 * A box seen from the camera: its roof, its left side and its front. The other
 * three faces face away and are never drawn. `x`/`y` place the footprint,
 * `z` lifts it, `w`/`d`/`h` are width, depth (along y) and height.
 */
function Box({ x, y, w, d, z = 0, h, tc, lc, fc, left, front, className = "", scroll = false, style }) {
  return (
    <div
      className={`hw-box ${className}`}
      style={{ left: x, top: y, width: w, height: d, transform: z ? `translateZ(${z}px)` : undefined, ...style }}
    >
      <i className={`hw-f hw-top ${tc || ""}`} style={{ transform: `translateZ(${h}px)` }}>
        {scroll && <u className="hw-scroll" />}
      </i>
      <i className={`hw-f hw-left ${lc || ""}`} style={{ width: h, height: d }}>
        {scroll && <u className="hw-scroll" />}
        {left}
      </i>
      <i className={`hw-f hw-front ${fc || ""}`} style={{ width: w, height: h, top: d - h }}>
        {front}
      </i>
    </div>
  );
}

/** A wheel standing in the plane of the vehicle's side, resting on the road. */
function Wheel({ x, y, r, outer, spin }) {
  return (
    <i
      className={`hw-wheel${outer ? " is-outer" : ""}`}
      style={{ left: x - r, top: y - r, width: r * 2, height: r * 2, transform: `translateZ(${r}px) rotateY(90deg)` }}
    >
      {spin && <b className="hw-hub" />}
    </i>
  );
}

/** Stacked discs give a tyre some thickness from an angle. */
function Tire({ y, r, thick = 2, spin = false, k = 1 }) {
  const step = (thick > 2 ? 3 : 2) * k;
  return (
    <>
      {Array.from({ length: thick }, (_, i) => (
        <Wheel key={i} x={-i * step} y={y} r={r} outer={i === thick - 1} spin={spin && i === thick - 1} />
      ))}
    </>
  );
}

/** Headlights facing forward, tail lights facing back — whichever end shows. */
function Lights({ dir, inset = 2 }) {
  const cls = dir > 0 ? "hw-hl" : "hw-tl";
  return (
    <>
      <b className={cls} style={{ left: inset }} />
      <b className={cls} style={{ right: inset }} />
    </>
  );
}

/** The pool of headlight on the tarmac, lit only after dark. */
function Cone({ dir, w, d, long = 230, wide = 28 }) {
  return (
    <i
      className={`hw-cone${dir < 0 ? " rev" : ""}`}
      style={{ left: -wide / 2, width: w + wide, height: long, top: dir > 0 ? d - 2 : 2 - long }}
    />
  );
}

function Car({ dir }) {
  const d = 74;
  return (
    <>
      <i className="hw-shadow" style={{ left: -9, top: 7, width: 42, height: 70 }} />
      <Box x={0} y={0} w={34} d={d} z={6} h={13} front={<Lights dir={dir} />} />
      <Box x={3} y={dir > 0 ? 15 : d - 15 - 36} w={28} d={36} z={19} h={11} lc="hw-glass" fc="hw-glass" />
      <Tire y={14} r={8} />
      <Tire y={60} r={8} />
      <Cone dir={dir} w={34} d={d} />
    </>
  );
}

function Van({ dir }) {
  const d = 88;
  return (
    <>
      <i className="hw-shadow" style={{ left: -10, top: 8, width: 46, height: 84 }} />
      <Box
        x={0}
        y={0}
        w={38}
        d={d}
        z={6}
        h={30}
        left={<b className="hw-win" style={{ left: 16, width: 11, top: dir > 0 ? 58 : 8, height: 22 }} />}
        front={
          <>
            {dir > 0 && <b className="hw-ws" />}
            <Lights dir={dir} inset={3} />
          </>
        }
      />
      <Tire y={16} r={8} />
      <Tire y={72} r={8} />
      <Cone dir={dir} w={38} d={d} />
    </>
  );
}

/**
 * A cab-over box truck. `s` scales it (the hero is 1, passing traffic is
 * smaller) and `dir` says which end is the cab.
 */
function Rig({ s = 1, dir = 1, hero = false }) {
  const n = (v) => Math.round(v * s * 10) / 10;
  const L = 140;
  // Positions are written for a truck heading +y; heading -y mirrors them end to end.
  const at = (y, len) => n(dir > 0 ? y : L - y - len);
  const cabFront = (
    <>
      <b className="hw-ws" />
      <b className="hw-grille" />
      {/* `top: auto` matters: the shared lamp rule pins lights to top: 3px, which
          wins over `bottom` and was keeping these up beside the windshield. */}
      <b className="hw-hl" style={{ left: n(4), top: "auto", bottom: n(5), width: n(10), height: n(6) }} />
      <b className="hw-hl" style={{ right: n(4), top: "auto", bottom: n(5), width: n(10), height: n(6) }} />
      <b className="hw-bumper" />
    </>
  );
  return (
    <>
      <i className="hw-shadow" style={{ left: n(-26), top: n(10), width: n(66), height: n(134) }} />
      <div className="hw-sus">
        <Box x={n(3)} y={at(4, 134)} w={n(58)} d={n(134)} z={n(5)} h={n(10)} className="hw-dark" />
        <Box
          x={n(1)}
          y={at(2, 88)}
          w={n(62)}
          d={n(88)}
          z={n(14)}
          h={n(62)}
          className="hw-cargo"
          left={
            <>
              <b className="hw-stripe" style={hero ? { left: n(11), width: n(6) } : undefined} />
              {hero && (
                <span className="hw-brand" style={{ left: n(22), width: n(34), fontSize: n(12) }}>
                  TRACKIFY
                </span>
              )}
            </>
          }
          front={dir < 0 ? <Lights dir={dir} inset={n(3)} /> : null}
        />
        <Box
          x={n(2)}
          y={at(94, 42)}
          w={n(60)}
          d={n(42)}
          z={n(14)}
          h={n(44)}
          className="hw-cab"
          style={hero ? { "--c": "#4a90f7" } : undefined}
          left={<b className="hw-win" style={{ left: n(22), width: n(18), top: dir > 0 ? n(5) : n(9), height: n(28) }} />}
          front={dir > 0 ? cabFront : null}
        />
      </div>
      <Tire y={n(30)} r={n(14)} thick={hero ? 3 : 2} spin={hero} k={hero ? s : 1} />
      <Tire y={n(104)} r={n(14)} thick={hero ? 3 : 2} spin={hero} k={hero ? s : 1} />
      <Cone dir={dir} w={n(64)} d={n(140)} long={hero ? 330 : 230} wide={hero ? 14 : 28} />
    </>
  );
}

const SIZE = { car: [34, 74], van: [38, 88], rig: [46, 100.8] };

/*
 * The truck is sized to its lane. The lane lines sit 32 either side of the
 * centre, so the body plus the wheels that stand proud of its left side must
 * clear them. The wrapper is placed so that whole width — wheels included —
 * is centred on the lane, leaving a gap to the paint on both sides.
 */
const HERO_SCALE = 0.78;
const HERO_W = Math.round(64 * HERO_SCALE * 10) / 10;
const HERO_L = Math.round(140 * HERO_SCALE * 10) / 10;
const HERO_OVERHANG = 6 * HERO_SCALE; // outer tyre disc sits this far left of the body
const HERO_BOX = {
  left: (HERO_OVERHANG - HERO_W) / 2,
  top: -HERO_L / 2,
  width: HERO_W,
  height: HERO_L,
  "--c": "#1f5fe0",
};

function Traffic({ t }) {
  const [w, d] = SIZE[t.k];
  const T = PATH / Math.abs(t.v);
  return (
    <div
      className="hw-veh"
      data-rev={t.v < 0 ? "" : undefined}
      style={{ left: t.x - w / 2, top: -d / 2, width: w, height: d, "--c": t.c, "--T": `${T.toFixed(2)}s`, "--dl": `${(-t.at * T).toFixed(2)}s` }}
    >
      {t.k === "car" && <Car dir={t.dir} />}
      {t.k === "van" && <Van dir={t.dir} />}
      {t.k === "rig" && <Rig s={0.72} dir={t.dir} />}
    </div>
  );
}

/* ---------------------------------------------------------------- the scene */

/** Follows the app's light/dark choice, including changes made while mounted. */
function useNight() {
  const [night, setNight] = useState(() => resolvedTheme() === "dark");
  useEffect(() => {
    const sync = () => setNight(resolvedTheme() === "dark");
    sync();
    const watch = new MutationObserver(sync);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    let media;
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener?.("change", sync);
    } catch {
      // No matchMedia in older webviews; the explicit data-theme still works.
    }
    return () => {
      watch.disconnect();
      media?.removeEventListener?.("change", sync);
    };
  }, []);
  return night;
}

export default function DriverHighway() {
  const root = useRef(null);
  const night = useNight();

  // Scale the world to the band it lives in, and keep the truck above the
  // headline rather than under it, whatever the phone.
  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      el.style.setProperty("--hw-s", Math.min(2, Math.max(0.85, Math.min(w / 300, h / 440))).toFixed(3));
      el.style.setProperty("--hw-cx", `${Math.round(w * 0.46)}px`);
      el.style.setProperty("--hw-cy", `${Math.round(h * 0.4)}px`);
    };
    fit();
    if (typeof ResizeObserver === "undefined") return undefined;
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return (
    <div ref={root} className="hw" data-night={night ? "true" : "false"} aria-hidden="true">
      <div className="hw-world">
        {/* the tarmac: lane paint and wear scroll inside it, clipped to its edges */}
        <div className="hw-road">
          <div className="hw-flow" style={{ "--T": `${(288 / SPEED).toFixed(3)}s` }} />
          <div className="hw-streaks" />
        </div>

        {/* a soft pool under the truck, so it never sinks into the road */}
        <i className="hw-spot day" />
        <i className="hw-spot night" />

        {/* concrete median and the guard rail on the near edge */}
        <Box x={105} y={-1600} w={14} d={3200} h={12} className="hw-barrier" scroll />
        <Box x={-106} y={-1600} w={4} d={3200} h={7} className="hw-rail" scroll />

        <div className="hw-strip" style={{ "--P": 520, "--T": `${(520 / SPEED).toFixed(3)}s` }}>
          {TREES.map((t) => (
            <i key={t.key} className="hw-tree" style={{ left: t.x, top: t.y, "--z": t.sz }} />
          ))}
        </div>
        <div className="hw-strip" style={{ "--P": LAMP_GAP, "--T": `${(LAMP_GAP / SPEED).toFixed(3)}s` }}>
          {LAMPS.map((l) => (
            <i key={l.key} className="hw-lamp" style={{ left: 112, top: l.y }} />
          ))}
        </div>

        {TRAFFIC.map((t, i) => (
          <Traffic key={i} t={t} />
        ))}

        {/* the truck: the one thing that does not move */}
        <div className="hw-veh hw-hero" style={HERO_BOX}>
          <Rig hero s={HERO_SCALE} />
        </div>
      </div>

      <div className="hw-fx" />
    </div>
  );
}
