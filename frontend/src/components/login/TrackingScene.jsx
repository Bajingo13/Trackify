import { useEffect, useState } from "react";
import "./tracking-scene.css";

/* Isometric delivery map with a follow-camera. The whole city (grid + buildings)
   pans and rotates around the truck while it runs a winding route from the
   AstreaBlue hub to the drop-off. */

const COS30 = 0.866;
const iso = (x, y, z = 0) => [(x - y) * COS30, (x + y) * 0.5 - z];
const poly = (a) => a.map((p) => p.join(",")).join(" ");

const CENTER_X = 260;
const CENTER_Y = 152;

/* winding route in grid space — equal x/y offset = purely vertical wiggle on screen */
function route(t) {
  const gx = -210 + 420 * t;
  const gy = 210 - 420 * t;
  const off = 62 * Math.sin(t * Math.PI * 2.3) + 22 * Math.sin(t * Math.PI * 5.1);
  return [gx + off, gy + off];
}
const routeScreen = (t) => iso(...route(t));

const BUILDINGS = [
  { x: -300, y: -60, w: 40, d: 44, h: 66 }, { x: -250, y: -180, w: 36, d: 36, h: 104 },
  { x: -170, y: -120, w: 44, d: 34, h: 52 }, { x: -120, y: -240, w: 34, d: 38, h: 120 },
  { x: -40, y: -170, w: 38, d: 38, h: 78 }, { x: 30, y: -250, w: 42, d: 36, h: 96 },
  { x: 110, y: -180, w: 34, d: 34, h: 132 }, { x: 190, y: -120, w: 40, d: 42, h: 60 },
  { x: 260, y: -210, w: 36, d: 36, h: 88 }, { x: 320, y: -70, w: 38, d: 40, h: 72 },
  { x: -280, y: 90, w: 42, d: 46, h: 50 }, { x: -180, y: 60, w: 34, d: 34, h: 68 },
  { x: -90, y: 140, w: 40, d: 38, h: 44 }, { x: 60, y: 90, w: 36, d: 40, h: 58 },
  { x: 160, y: 150, w: 44, d: 40, h: 46 }, { x: 250, y: 80, w: 38, d: 36, h: 76 },
  { x: 330, y: 170, w: 40, d: 44, h: 54 }, { x: -30, y: 250, w: 42, d: 38, h: 62 },
].sort((a, b) => a.x + a.y - (b.x + b.y));

const STOPS = ["Dispatched", "In transit", "Out for delivery", "Delivered"];
const TRIP_SECONDS = 5 * 3600;
const LOOP_MS = 18000;

function Building({ x, y, w, d, h, hub }) {
  const top = [iso(x, y, h), iso(x + w, y, h), iso(x + w, y + d, h), iso(x, y + d, h)];
  const right = [iso(x + w, y, h), iso(x + w, y, 0), iso(x + w, y + d, 0), iso(x + w, y + d, h)];
  const left = [iso(x, y + d, h), iso(x, y + d, 0), iso(x + w, y + d, 0), iso(x + w, y + d, h)];
  return (
    <g className={`ts-bld${hub ? " ts-bld-hub" : ""}`}>
      <polygon className="face-l" points={poly(left)} />
      <polygon className="face-r" points={poly(right)} />
      <polygon className="face-t" points={poly(top)} />
    </g>
  );
}

export default function TrackingScene() {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf;
    let start;
    const tick = (now) => {
      if (start === undefined) start = now;
      setT(((now - start) % LOOP_MS) / LOOP_MS);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const [twx, twy] = routeScreen(t);
  const [nx, ny] = routeScreen(Math.min(1, t + 0.012));
  const heading = (Math.atan2(ny - twy, nx - twx) * 180) / Math.PI;
  const rot = -5 + 10 * t;
  const cam = `translate(${CENTER_X} ${CENTER_Y}) rotate(${rot}) translate(${-twx} ${-twy})`;

  const [bwx, bwy] = routeScreen(1);

  // progressively drawn route
  const drawn = [];
  const full = [];
  for (let s = 0; s <= 1.0001; s += 0.02) {
    const p = routeScreen(s);
    full.push(p);
    if (s <= t) drawn.push(p);
  }
  drawn.push([twx, twy]);

  const distLeft = Math.max(0, Math.round(940 * (1 - t)));
  const etaSec = Math.max(0, Math.round((1 - t) * TRIP_SECONDS));
  const hh = String(Math.floor(etaSec / 3600)).padStart(2, "0");
  const mm = String(Math.floor((etaSec % 3600) / 60)).padStart(2, "0");
  const stopIdx = Math.min(STOPS.length - 1, Math.floor(t * STOPS.length + 0.0001));

  const lines = [];
  for (let i = -640; i <= 640; i += 40) {
    lines.push([iso(i, -640), iso(i, 640)]);
    lines.push([iso(-640, i), iso(640, i)]);
  }

  return (
    <div className="ts" aria-hidden="true">
      <div className="ts-strip">
        <span className="ts-live"><i />IN TRANSIT</span>
        <span>ETA&nbsp;<b className="tk-mono">{hh}:{mm}</b></span>
        <span><b className="tk-mono">{distLeft}</b>&nbsp;km left</span>
      </div>

      <svg className="ts-svg" viewBox="0 0 520 300" preserveAspectRatio="xMidYMid slice">
        <g transform={cam}>
          <g className="ts-grid">
            {lines.map(([p1, p2], i) => (
              <line key={i} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} />
            ))}
          </g>

          <polyline className="ts-route" points={poly(full)} />
          <polyline className="ts-route-lit" points={poly(drawn)} />

          {BUILDINGS.map((b, i) => <Building key={i} {...b} />)}
          <Building x={-244} y={188} w={58} d={54} h={34} hub />

          <g className="ts-beacon" transform={`translate(${bwx} ${bwy})`}>
            <circle className="ts-beacon-ping" r="7" />
            <circle className="ts-beacon-core" r="4.5" />
          </g>

          <g className="ts-truck" transform={`translate(${twx} ${twy}) rotate(${heading})`}>
            <ellipse className="ts-truck-shadow" cx="0" cy="9" rx="24" ry="7" />
            <g className="ts-truck-bob">
              <svg x="-24" y="-24" width="48" height="34" viewBox="0 0 96 66" overflow="visible">
                <defs>
                  <linearGradient id="tsBox" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#3f66db" /><stop offset="1" stopColor="#16327f" />
                  </linearGradient>
                  <linearGradient id="tsCab" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#5c82ec" /><stop offset="1" stopColor="#1f47b8" />
                  </linearGradient>
                </defs>
                <rect x="2" y="6" width="60" height="40" rx="4" fill="url(#tsBox)" stroke="#12327f" strokeWidth="1.5" />
                <rect x="3" y="7" width="58" height="7" rx="3" fill="#cfe0ff" opacity="0.35" />
                <g stroke="#cfe0ff" strokeWidth="1.2" opacity="0.4">
                  <line x1="16" y1="10" x2="16" y2="42" /><line x1="30" y1="10" x2="30" y2="42" />
                  <line x1="44" y1="10" x2="44" y2="42" />
                </g>
                <path d="M62 15 h17 c3 0 5 1 7 4 l7 12 c1.4 2.4 2 4.4 2 7 v6 h-40 z"
                  fill="url(#tsCab)" stroke="#12327f" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M80 18 h-13 v13 h21 l-4 -9 c-1 -2.6 -2.2 -4 -4 -4 z" fill="#dbe8ff" opacity="0.9" />
                <rect x="93" y="38" width="4" height="5" rx="1.2" fill="#ffd873" />
                <g className="ts-wheel">
                  <circle cx="20" cy="47" r="7.5" fill="#0c1a38" stroke="#12327f" strokeWidth="1.5" />
                  <circle cx="20" cy="47" r="2.4" fill="#9db6f0" />
                </g>
                <g className="ts-wheel">
                  <circle cx="78" cy="47" r="7.5" fill="#0c1a38" stroke="#12327f" strokeWidth="1.5" />
                  <circle cx="78" cy="47" r="2.4" fill="#9db6f0" />
                </g>
              </svg>
            </g>
          </g>
        </g>
      </svg>

      <div className="ts-foot">
        <div className="ts-foot-dots">
          {STOPS.map((s, i) => (
            <span key={s} className={`d${i < stopIdx ? " done" : ""}${i === stopIdx ? " on" : ""}`} />
          ))}
        </div>
        <span className="ts-foot-status">{STOPS[stopIdx]}</span>
      </div>
    </div>
  );
}
