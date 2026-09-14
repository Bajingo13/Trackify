import VehicleArt from "./VehicleArt";
import { photoFor } from "./vehiclePhotos";
import { useTypePhoto } from "../../services/fleet/vehicleTypePhotos";
import "./vehiclePhoto.css";

export { photoFor };

/**
 * A JPEG cannot carry transparency, so one is always a rectangle of pixels —
 * and these particular photographs are a white truck on a white studio sweep.
 * Presented raw on a dark surface that reads as a bug, so an opaque source is
 * given a deliberate light plate instead of being left to look broken.
 *
 * A PNG or WebP may have a transparent background, so it is trusted to sit
 * directly on whatever surface it lands on. That is what makes this
 * self-correcting: the moment a company uploads a cut-out PNG, its plate
 * disappears without anyone changing code.
 */
function isOpaque(src) {
  if (!src) return false;
  if (src.startsWith("data:")) return src.startsWith("data:image/jpeg");
  return /\.jpe?g(\?|$)/i.test(src);
}

/**
 * Vehicle photography for the web system.
 *
 * Three sources, in order: the photograph this company uploaded for the type,
 * the photograph bundled with the app, then the drawn silhouette. The drawing
 * also wins outright when a load ratio is supplied, because how full a truck
 * is cannot be shown by a photograph of an empty one.
 */
export default function VehiclePhoto({
  type,
  height,
  muted = false,
  animated = false,
  load = null,
  className,
  style,
}) {
  const ownPhoto = useTypePhoto(type);
  const src = ownPhoto || photoFor(type);

  if (!src || load != null) {
    return (
      <VehicleArt
        type={type}
        height={height ?? 72}
        muted={muted}
        animated={animated}
        load={load}
        className={className}
        style={style}
      />
    );
  }

  const h = height ?? 72;

  return (
    <span
      className={[
        "veh-photo",
        isOpaque(src) ? "is-plated" : "is-cutout",
        animated ? "is-moving" : "",
        muted ? "is-muted" : "",
        className || "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--veh-h": `${h}px`, ...style }}
    >
      <img src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" />
    </span>
  );
}
