import { useEffect, useState } from "react";
import { getDriverPhoto } from "../../services/fleet/driverService";

function initialsOf(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/**
 * The driver's picture, as they uploaded it in the Driver app — or their
 * initials until they do.
 *
 * `version` (the photo's updated-at stamp) is a dependency on purpose: it
 * changes when the driver saves a new photo, which is what makes the
 * replacement show instead of the old one. Decorative: the name is always
 * written out beside it.
 */
export default function DriverFace({ driverId, name, hasPhoto, version, size = 44 }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let off = false;
    setSrc(null);
    if (driverId == null || !hasPhoto) return undefined;
    (async () => {
      try {
        const url = await getDriverPhoto(driverId, version);
        if (!off) setSrc(url);
      } catch {
        /* no picture, or no access: the initials stand in */
      }
    })();
    return () => { off = true; };
  }, [driverId, hasPhoto, version]);

  return (
    <span className="tk-driver-face" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initialsOf(name) || "—"}
    </span>
  );
}
