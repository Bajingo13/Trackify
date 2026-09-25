/**
 * Offline queue for the driver app.
 *
 * A truck between Davao and Zamboanga loses signal for long stretches. Without
 * this, every GPS ping and every expense the driver files while out of
 * coverage is simply lost, and the driver has no way of knowing.
 *
 * Requests are parked in IndexedDB — not localStorage, because a receipt photo
 * is a Blob and localStorage only holds strings — and replayed in the order
 * they were made once the device is back online.
 *
 * GPS pings are treated differently from everything else. A ping is only
 * interesting while it is fresh: replaying an hour of stale positions would
 * draw a trail the truck already finished driving. So pings expire, and only
 * the most recent few are kept. Deliveries and expenses never expire — those
 * are records the driver believes they have filed.
 */

const DB_NAME = "trackify-driver";
const STORE = "outbox";
const PING_TTL_MS = 15 * 60 * 1000; // a position older than this is history
const MAX_PINGS = 20;

let dbPromise = null;

function normalizedOwnerId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

export const isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/** Park a request for later. `body` is a plain object or FormData entries. */
export async function enqueue(item) {
  const ownerId = normalizedOwnerId(item?.ownerId);
  if (!ownerId) return false;
  try {
    await tx("readwrite", (s) => s.add({ ...item, ownerId, queuedAt: Date.now() }));
    if (item.kind === "ping") await trimPings(ownerId);
    notify();
    return true;
  } catch {
    return false;
  }
}

/**
 * A long dead zone must not grow IndexedDB forever. Keeping the newest fixes
 * is enough to reconnect dispatch to the truck; older ones are already behind
 * it and will either expire or draw a misleading trail when signal returns.
 */
async function trimPings(ownerId) {
  await tx("readwrite", (s) => {
    const request = s.getAll();
    request.onsuccess = () => {
      const pings = (request.result || [])
        .filter((row) => row.kind === "ping" && row.ownerId === ownerId)
        .sort((a, b) => a.id - b.id);
      for (const row of pings.slice(0, -MAX_PINGS)) s.delete(row.id);
    };
  });
}

export async function pending(ownerId) {
  try {
    const all = await tx("readonly", (s) => s.getAll());
    if (!Array.isArray(all)) return [];
    const owner = normalizedOwnerId(ownerId);
    return owner ? all.filter((row) => row.ownerId === owner) : [];
  } catch {
    return [];
  }
}

async function remove(id) {
  try { await tx("readwrite", (s) => s.delete(id)); } catch { /* gone already */ }
}

/** How many items are waiting, split so the UI can word it honestly. */
export async function pendingCount(ownerId) {
  const rows = await pending(ownerId);
  return {
    total: rows.length,
    pings: rows.filter((r) => r.kind === "ping").length,
    records: rows.filter((r) => r.kind !== "ping").length,
  };
}

const listeners = new Set();
export function onQueueChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() { listeners.forEach((fn) => { try { fn(); } catch { /* listener's problem */ } }); }

/**
 * Replay everything waiting, oldest first. Stops at the first network failure
 * so ordering is preserved — a delivery must not overtake the trip start that
 * has to precede it.
 *
 * A 4xx means the server understood and refused: replaying it forever would
 * block the queue, so it is dropped and reported.
 */
const inFlightByOwner = new Map();

export async function flush(send, ownerId) {
  if (!isOnline()) return { sent: 0, dropped: 0 };
  const owner = normalizedOwnerId(ownerId);
  if (!owner) return { sent: 0, dropped: 0 };
  // Two callers can arrive at once — the online event and a mount check, say.
  // Without this they both read the same rows before either deletes one, and
  // the driver's expense is filed twice.
  if (inFlightByOwner.has(owner)) return inFlightByOwner.get(owner);
  const running = drain(send, owner).finally(() => { inFlightByOwner.delete(owner); });
  inFlightByOwner.set(owner, running);
  return running;
}

async function drain(send, ownerId) {

  const rows = (await pending(ownerId)).sort((a, b) => a.id - b.id);
  let sent = 0;
  let dropped = 0;
  const now = Date.now();

  // stale positions are discarded rather than replayed as a false trail
  const freshPings = rows.filter((r) => r.kind === "ping" && now - r.queuedAt < PING_TTL_MS).slice(-MAX_PINGS);
  const keep = new Set(freshPings.map((r) => r.id));

  for (const row of rows) {
    if (row.kind === "ping" && !keep.has(row.id)) {
      await remove(row.id);
      dropped += 1;
      continue;
    }
    try {
      await send(row);
      await remove(row.id);
      sent += 1;
    } catch (err) {
      if (err?.status >= 400 && err.status < 500) {
        await remove(row.id);
        dropped += 1;
        continue;
      }
      break; // still offline or the server is down — keep the rest in order
    }
  }

  if (sent || dropped) notify();
  return { sent, dropped };
}

/** Clears only one driver's saved work; an absent owner fails closed. */
export async function clearQueue(ownerId) {
  const owner = normalizedOwnerId(ownerId);
  if (!owner) return;
  try {
    const rows = await pending(owner);
    await tx("readwrite", (s) => {
      for (const row of rows) s.delete(row.id);
    });
    notify();
  } catch { /* nothing to clear */ }
}
