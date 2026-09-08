import { useEffect, useRef, useState } from "react";

/**
 * Glide map markers between GPS fixes.
 *
 * A driver's phone reports roughly every 20 seconds, so a marker drawn
 * straight from the raw feed teleports several hundred metres at a time. The
 * position is real, but the movement reads as broken rather than live.
 *
 * This eases each marker from where it is drawn now to its newest fix over a
 * short window, so the truck slides along the road instead of jumping. It
 * invents no data: the destination of every glide is a real reported fix, and
 * the marker is never ahead of one. It only fills in the travel between two
 * points the vehicle genuinely occupied.
 *
 * A fix that arrives mid-glide simply becomes the new target, so the marker
 * changes course smoothly rather than snapping.
 *
 * Usage:
 *   const smooth = useSmoothedPositions(targets);  // [{ id, lat, lng }]
 */

// Long enough to read as motion, short enough that the marker is never
// meaningfully behind the truck.
const GLIDE_MS = 1800;

// Beyond this, the vehicle did not drive there — it is a first fix, a GPS
// jump, or a trip that reappeared somewhere else. Snap instead of gliding
// across the map.
const MAX_GLIDE_KM = 5;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function km(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export default function useSmoothedPositions(targets) {
  const [frame, setFrame] = useState(() => targets || []);
  const tracks = useRef(new Map()); // id -> { from, to, startedAt }
  const raf = useRef(0);

  useEffect(() => {
    const list = Array.isArray(targets) ? targets : [];
    const now = performance.now();
    const snap = prefersReducedMotion();
    const seen = new Set();

    for (const t of list) {
      if (!Number.isFinite(t.lat) || !Number.isFinite(t.lng)) continue;
      const id = String(t.id);
      seen.add(id);
      const track = tracks.current.get(id);
      const to = { lat: t.lat, lng: t.lng };

      if (!track) {
        // first sighting — appear where the vehicle actually is
        tracks.current.set(id, { from: to, to, startedAt: 0 });
        continue;
      }
      if (track.to.lat === to.lat && track.to.lng === to.lng) continue;

      // start the new glide from wherever the marker is drawn right now, so a
      // fix arriving mid-glide bends the path instead of snapping back
      const from = positionAt(track, now);
      const jumped = snap || km(from, to) > MAX_GLIDE_KM;
      tracks.current.set(id, { from: jumped ? to : from, to, startedAt: now });
    }

    for (const id of tracks.current.keys()) {
      if (!seen.has(id)) tracks.current.delete(id);
    }
  }, [targets]);

  useEffect(() => {
    const tick = () => {
      const now = performance.now();
      const list = Array.isArray(targets) ? targets : [];
      let moving = false;

      const next = list.map((t) => {
        const track = tracks.current.get(String(t.id));
        if (!track) return t;
        const p = positionAt(track, now);
        if (now - track.startedAt < GLIDE_MS) moving = true;
        return { ...t, lat: p.lat, lng: p.lng };
      });

      setFrame(next);
      // idle when nothing is gliding — no permanent animation loop
      raf.current = moving ? requestAnimationFrame(tick) : 0;
    };

    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [targets]);

  return frame;
}

function positionAt(track, now) {
  const elapsed = now - track.startedAt;
  if (!track.startedAt || elapsed >= GLIDE_MS) return track.to;
  const k = easeOutCubic(Math.max(0, elapsed) / GLIDE_MS);
  return {
    lat: track.from.lat + (track.to.lat - track.from.lat) * k,
    lng: track.from.lng + (track.to.lng - track.from.lng) * k,
  };
}
