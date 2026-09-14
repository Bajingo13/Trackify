import VehicleArt from "./VehicleArt";
import { photoFor } from "./vehiclePhotos";

export { photoFor };

/**
 * Vehicle photography for the web system. A supplied load ratio keeps the SVG
 * because that drawing communicates real capacity data that a photo cannot.
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
  const src = photoFor(type);

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

  return (
    <img
      className={className}
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      style={{
        display: "block",
        width: height ? Math.round(height * 1.65) : undefined,
        height,
        maxWidth: "100%",
        objectFit: "contain",
        borderRadius: "var(--r-sm, 8px)",
        background: "#fff",
        filter: muted ? "grayscale(1) opacity(.55)" : undefined,
        ...style,
      }}
    />
  );
}
