import { useCallback, useEffect, useState } from "react";

/**
 * A reminder to rest after long enough on the road.
 *
 * Worked out on the phone and kept there: nothing is sent to the office, and
 * nothing about it is a record of anything. It is a nudge, so it never blocks
 * the screen, plays a sound or vibrates — a driver who is still driving should
 * be able to ignore it until they stop.
 *
 * The trip carries no "started at", so the clock starts when this phone first
 * sees the run on the road: right after Start trip, or on opening a run that
 * was already started. That can only be later than the real start, so the
 * reminder can come late but never early. It starts over when the driver says
 * they have rested, and while an approved pause has the truck stopped.
 */

export const DRIVE_LIMIT_MS = 4 * 60 * 60 * 1000;
export const SNOOZE_MS = 30 * 60 * 1000;

const keyFor = (driverId, tripId) => `trackify-driver-break:${driverId}:${tripId}`;

export function readBreak(driverId, tripId) {
  try {
    const raw = localStorage.getItem(keyFor(driverId, tripId));
    const v = raw ? JSON.parse(raw) : null;
    return v && Number.isFinite(v.since) ? { since: v.since, snoozeUntil: Number(v.snoozeUntil) || 0 } : null;
  } catch {
    return null;
  }
}

export function writeBreak(driverId, tripId, value) {
  try {
    if (value) localStorage.setItem(keyFor(driverId, tripId), JSON.stringify(value));
    else localStorage.removeItem(keyFor(driverId, tripId));
  } catch {
    /* full or blocked: the clock just lives as long as the screen does */
  }
}

/** Is a break due, and how long has the driver been going? */
export function breakState(clock, now) {
  if (!clock) return { due: false, drivenMs: 0 };
  const drivenMs = Math.max(0, now - clock.since);
  return { due: drivenMs >= DRIVE_LIMIT_MS && now >= (clock.snoozeUntil || 0), drivenMs };
}

/** "4 h 12 min", "4 h" */
export function drivenLabel(ms) {
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * The reminder for one run. `onRoad` is the run being in transit; `resting` is
 * an approved pause. Checked once a minute while the screen is open.
 */
export function useBreakReminder(driverId, tripId, onRoad, resting) {
  const [now, setNow] = useState(() => Date.now());
  const [clock, setClock] = useState(() => readBreak(driverId, tripId));

  useEffect(() => {
    if (!onRoad) return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(t);
  }, [onRoad]);

  // start the clock the first time the run is seen on the road, and hold it at
  // "now" while an approved pause has the truck stopped
  useEffect(() => {
    if (!driverId || !tripId || !onRoad) return;
    const stored = readBreak(driverId, tripId);
    if (!stored || resting) {
      const next = { since: Date.now(), snoozeUntil: 0 };
      writeBreak(driverId, tripId, next);
      setClock(next);
    } else {
      setClock(stored);
    }
  }, [driverId, tripId, onRoad, resting, now]);

  const save = useCallback((next) => {
    writeBreak(driverId, tripId, next);
    setClock(next);
    setNow(Date.now());
  }, [driverId, tripId]);

  const rested = useCallback(() => save({ since: Date.now(), snoozeUntil: 0 }), [save]);
  const later = useCallback(
    () => save({ ...(clock || { since: Date.now() }), snoozeUntil: Date.now() + SNOOZE_MS }),
    [save, clock]
  );

  const { due, drivenMs } = onRoad && !resting ? breakState(clock, now) : { due: false, drivenMs: 0 };
  return { due, drivenMs, rested, later };
}
