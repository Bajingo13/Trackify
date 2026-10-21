/**
 * The last copy of the driver's trips that the server sent, kept on the phone.
 *
 * Navigation must survive a dead zone, including a cold start in one: the app
 * reopened on a mountain road has to be able to show the run and its route.
 * So every trip the server sends is kept here, and the screens fall back to it
 * when a load fails. A copy is only ever shown as a copy ("Saved copy from
 * 9:42"), never as live data: the service worker's rule that API answers are
 * never cached stands, and this store is the one explicit exception.
 *
 * Its own database rather than a store in the outbox's, so the outbox's
 * schema, and every phone's upgrade path through it, stays as it is.
 */

const DB_NAME = "trackify-driver-trips";
const STORE = "trips";

let dbPromise = null;

function open() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("no IndexedDB"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
  });
}

const tripKey = (ownerId, tripId) => `${ownerId}:trip:${tripId}`;
const listKey = (ownerId) => `${ownerId}:list`;

/* A cache is a convenience: failing to write or read it never fails the screen. */
const put = (key, data) =>
  run("readwrite", (s) => s.put({ data, savedAt: Date.now() }, key)).catch(() => {});
const get = (key) => run("readonly", (s) => s.get(key)).then((row) => row || null).catch(() => null);

/** Keep the trip the server just sent. */
export const saveTrip = (ownerId, trip) => (ownerId && trip?.id != null ? put(tripKey(ownerId, trip.id), trip) : Promise.resolve());

/** { data, savedAt } or null. */
export const cachedTrip = (ownerId, tripId) => (ownerId ? get(tripKey(ownerId, tripId)) : Promise.resolve(null));

/** Keep the trips list the server just sent. */
export const saveTrips = (ownerId, trips) => (ownerId && Array.isArray(trips) ? put(listKey(ownerId), trips) : Promise.resolve());

/** { data, savedAt } or null. */
export const cachedTrips = (ownerId) => (ownerId ? get(listKey(ownerId)) : Promise.resolve(null));

/** Everything kept for this driver: on sign-out, nothing of theirs stays on the phone. */
export async function clearTripCache(ownerId) {
  if (!ownerId) return;
  const prefix = `${ownerId}:`;
  await run("readwrite", (s) => {
    const req = s.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      if (String(cur.key).startsWith(prefix)) cur.delete();
      cur.continue();
    };
  }).catch(() => {});
}

/** "9:42 AM" today, "Oct 20, 9:42 AM" otherwise: when a saved copy was made. */
export function savedAtLabel(ms, now = new Date()) {
  const d = new Date(ms);
  const sameDay = d.toDateString() === now.toDateString();
  return d.toLocaleString([], sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
