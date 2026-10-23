/**
 * A Google Maps directions link to where the driver is heading, or null when
 * there is nowhere to send them.
 *
 * The pin comes first: it is what the office placed, and what arrival is
 * measured against (arrival.js), whereas the address is free text the maps app
 * has to guess at. A missing or unusable pin — no number, or 0,0, which is what
 * an unset coordinate tends to become — falls back to the address.
 *
 * The https form rather than geo: or a Maps-only scheme, because it is the one
 * link every phone can open: Android hands it to the Maps app, iOS to Maps or
 * the browser, and a desktop browser just shows the route.
 */
export function mapsHref({ lat, lng, address } = {}) {
  const base = "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=";
  const la = lat == null || lat === "" ? NaN : Number(lat);
  const ln = lng == null || lng === "" ? NaN : Number(lng);
  const pinned =
    Number.isFinite(la) && Number.isFinite(ln) &&
    Math.abs(la) <= 90 && Math.abs(ln) <= 180 &&
    !(la === 0 && ln === 0);
  if (pinned) return `${base}${la},${ln}`;

  const text = String(address ?? "").trim();
  return text ? `${base}${encodeURIComponent(text)}` : null;
}
