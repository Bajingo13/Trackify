/**
 * Where the phone is right now, or null.
 *
 * Read when the driver taps, not when a screen loaded: a record of reaching a
 * stop is only worth something if it says where the truck actually was. A
 * refused or slow fix is not an error — the record still counts, without
 * coordinates.
 */
export function readPosition() {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
    );
  });
}
