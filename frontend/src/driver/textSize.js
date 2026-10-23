import { useEffect, useState } from "react";

/**
 * Text size for the reading screens: Today, History, Claims, Profile and Help.
 *
 * The driver CSS sets its type in pixels, so this enlarges those screens with
 * CSS zoom on their container (DriverApp's .dr-screen) rather than a root font
 * size, which the pixel values would ignore. It is deliberately not applied to
 * a run (DriverTripScreen): the route map works out where a finger landed from
 * screen positions, and a zoomed map can put a tap in the wrong place. The
 * header and the tab bar keep their size too, so the frame of the app does not
 * move. The phone's own font-size setting still applies everywhere on top.
 *
 * Kept per phone, like the light/dark choice.
 */

/** One switch: normal, or large. */
export const TEXT_SIZES = [
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
];

const KEY = "trackify-driver-text-size";
const EVENT = "trackify-driver-text-size";

export function readTextSize() {
  try {
    const v = localStorage.getItem(KEY);
    // "larger" was a third step before the switch; it reads as on
    if (v === "larger") return "large";
    return TEXT_SIZES.some((s) => s.value === v) ? v : "normal";
  } catch {
    return "normal";
  }
}

export function setTextSize(value) {
  const next = TEXT_SIZES.some((s) => s.value === value) ? value : "normal";
  try {
    if (next === "normal") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    /* blocked: the choice lasts until the app is closed */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

/**
 * What the screen container gets: the size on a reading screen, and nothing —
 * normal size — while a run is open, whatever the choice.
 */
export function screenTextSize(inTrip, size) {
  return !inTrip && size && size !== "normal" ? size : undefined;
}

/** The current choice, following changes made anywhere in the app. */
export function useTextSize() {
  const [size, setSize] = useState(readTextSize);
  useEffect(() => {
    const onChange = (e) => setSize(e?.detail || readTextSize());
    const onStorage = () => setSize(readTextSize());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return size;
}
