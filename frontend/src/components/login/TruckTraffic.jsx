/**
 * Quiet background traffic for the account-setup screen: trucks seen from
 * above, driving in lanes — some heading down from the top, some up from the
 * bottom. Low contrast on purpose; it adds life without competing with the
 * form. Pure CSS animation (login.css, .lp-lane-*), frozen for people who ask
 * for reduced motion, and hidden from assistive technology.
 */

/* One vehicle from above, nose pointing up: cab, mirrors, windscreen, and a
   ribbed trailer behind a short coupling. Drawn in currentColor so the lane's
   colour and opacity carry through. */
function TruckFromAbove() {
  return (
    <svg viewBox="0 0 26 72" aria-hidden="true" focusable="false">
      {/* mirrors */}
      <rect x="0" y="7" width="3" height="2.4" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="23" y="7" width="3" height="2.4" rx="1" fill="currentColor" opacity="0.7" />
      {/* cab and windscreen */}
      <rect x="3" y="1" width="20" height="15" rx="5" fill="currentColor" />
      <rect x="5.5" y="3.5" width="15" height="4" rx="1.6" fill="#fff" opacity="0.55" />
      {/* coupling */}
      <rect x="10" y="16" width="6" height="3" fill="currentColor" opacity="0.6" />
      {/* trailer with roof ribs */}
      <rect x="2" y="19" width="22" height="52" rx="2.5" fill="currentColor" opacity="0.82" />
      {[27, 35, 43, 51, 59].map((y) => (
        <rect key={y} x="4" y={y} width="18" height="0.9" fill="#fff" opacity="0.28" />
      ))}
    </svg>
  );
}

/* Lanes across the page: position, direction, pace and start offset, varied
   so the traffic never looks like a pattern. */
const LANES = [
  { x: "4%", dir: "down", speed: 26, delay: -4, scale: 0.9, opacity: 0.1 },
  { x: "11%", dir: "up", speed: 32, delay: -19, scale: 1, opacity: 0.08 },
  { x: "18%", dir: "down", speed: 29, delay: -12, scale: 0.8, opacity: 0.09 },
  { x: "25%", dir: "up", speed: 24, delay: -7, scale: 1.05, opacity: 0.11 },
  { x: "32%", dir: "down", speed: 35, delay: -25, scale: 0.85, opacity: 0.07 },
  { x: "66%", dir: "up", speed: 28, delay: -15, scale: 0.9, opacity: 0.09 },
  { x: "73%", dir: "down", speed: 31, delay: -2, scale: 1, opacity: 0.1 },
  { x: "80%", dir: "up", speed: 25, delay: -21, scale: 0.8, opacity: 0.08 },
  { x: "87%", dir: "down", speed: 33, delay: -10, scale: 1.05, opacity: 0.11 },
  { x: "94%", dir: "up", speed: 27, delay: -27, scale: 0.9, opacity: 0.08 },
  // A second vehicle in a few lanes, half a lap behind, so lanes aren't empty for long.
  { x: "11%", dir: "up", speed: 32, delay: -3, scale: 0.9, opacity: 0.07 },
  { x: "25%", dir: "up", speed: 24, delay: -19, scale: 0.9, opacity: 0.09 },
  { x: "73%", dir: "down", speed: 31, delay: -17, scale: 0.9, opacity: 0.08 },
  { x: "87%", dir: "down", speed: 33, delay: -26, scale: 0.9, opacity: 0.09 },
];

export default function TruckTraffic() {
  return (
    <div className="lp-traffic" aria-hidden="true">
      {LANES.map((lane, i) => (
        <span
          key={i}
          className={`lp-lane-truck is-${lane.dir}`}
          style={{
            "--lane-x": lane.x,
            "--lane-speed": `${lane.speed}s`,
            "--lane-delay": `${lane.delay}s`,
            "--lane-scale": lane.scale,
            "--lane-opacity": lane.opacity,
          }}
        >
          <TruckFromAbove />
        </span>
      ))}
    </div>
  );
}
