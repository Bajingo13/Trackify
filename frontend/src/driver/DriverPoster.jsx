import "./driver-poster.css";
import trackifyLogo from "../assets/brand/trackify-logo.svg";

/**
 * The driver sign-in poster: the Trackify wordmark — the pin standing in for
 * the I, the speed line running into a box truck — on a charcoal ground.
 *
 * Still on purpose: it is a poster, not a scene. No animation — it paints once
 * and costs nothing after that.
 *
 * It stays dark in both themes, like a printed poster; the sign-in sheet over
 * it follows the driver's theme. So it always takes the silver-on-dark logo.
 */

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
 * The wordmark, sized to the room between the brand mark and the headline —
 * so on a short phone it shrinks rather than sliding under the words, and on a
 * tall one it stops growing.
 */
export function PosterTruck() {
  return (
    <div className="dp-stage" aria-hidden="true">
      <img className="dp-logo" src={trackifyLogo} alt="" draggable="false" />
    </div>
  );
}
