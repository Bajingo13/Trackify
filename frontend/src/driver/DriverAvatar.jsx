import { useEffect, useState } from "react";
import { driverBlobUrl } from "./driverApi";
import { initials } from "./DriverBits";

/**
 * The driver's own picture, for the Home header: the photo they uploaded on
 * Profile, or their initials until they have.
 *
 * The photo is behind auth, so it cannot be an <img src> pointed at the API. It
 * is fetched as a blob and revoked on the way out, the same way Profile does it.
 * `photoUpdatedAt` is in the dependencies on purpose: it changes when a new
 * photo is saved, which is what makes a replacement show up instead of the old
 * blob. Decorative: the name is written out beside it.
 */
export default function DriverAvatar({ name, hasPhoto, photoUpdatedAt }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let dead = false;
    let url = null;
    if (!hasPhoto) { setSrc(null); return undefined; }
    driverBlobUrl("/me/photo")
      .then((u) => {
        if (dead) { if (u) URL.revokeObjectURL(u); return; }
        url = u;
        setSrc(u);
      })
      .catch(() => { /* offline: the initials stand in until the next visit */ });
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [hasPhoto, photoUpdatedAt]);

  return (
    <span className="dr-avatar" aria-hidden="true">
      {src ? <img src={src} alt="" /> : initials(name) || "—"}
    </span>
  );
}
