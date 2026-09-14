import { useSyncExternalStore } from "react"
import { get, del, getDataUrl, postForm } from "../apiClient"

/**
 * A company's own photographs, one per kind of vehicle.
 *
 * These sit behind an authenticated route, so they cannot go straight into an
 * `img src` — and a fleet screen draws dozens of vehicles across a handful of
 * types, so fetching per element would mean the same photograph downloaded
 * twenty times. Both problems are solved the same way: fetch each type once,
 * keep it here as a data URL, and let every component read from the store.
 *
 * A data URL rather than an object URL, matching apiClient.getDataUrl — object
 * URLs need revoking, and getting that wrong under StrictMode pulls an image
 * out from under an element still decoding it.
 *
 * The store is deliberately module-level rather than React context. These
 * photographs are the same for every screen in a session, and threading a
 * provider through the fleet, dispatch, tracking and driver trees to say so
 * would be ceremony around a constant.
 */

const ENDPOINT = "/fleet/vehicle-types"

/** vehicleType -> data URL. A type present with null means "asked, has none". */
const photos = new Map()
const listeners = new Set()
let loading = null
let snapshot = { ready: false, photos }

function publish() {
  // a new object each time, so useSyncExternalStore sees a change
  snapshot = { ready: snapshot.ready, photos }
  listeners.forEach((l) => l())
}

function subscribe(listener) {
  listeners.add(listener)
  load()
  return () => listeners.delete(listener)
}

/**
 * Fetches the manifest, then each photograph it lists.
 *
 * The manifest carries updated_at per type; it is appended to the image URL so
 * a replacement is a different URL. Without it the browser serves the old
 * photograph from cache and the upload looks like it silently failed.
 */
export function load() {
  if (loading) return loading
  loading = (async () => {
    try {
      const res = await get(`${ENDPOINT}/photos`)
      const rows = res?.data || []
      await Promise.all(
        rows.map(async (row) => {
          // updated_at is a DATETIME, so it only resolves to the second. Byte
          // size goes in too: replacing a photo twice inside one second is
          // unlikely from a human, but the cost of being wrong is an operator
          // staring at the old picture deciding the upload does not work.
          const stamp = encodeURIComponent(`${row.updatedAt || ""}-${row.bytes ?? 0}`)
          const path = `${ENDPOINT}/${encodeURIComponent(row.vehicleType)}/photo?v=${stamp}`
          try {
            photos.set(row.vehicleType, await getDataUrl(path))
          } catch {
            // one unreadable photo must not cost the whole fleet its pictures
            photos.set(row.vehicleType, null)
          }
        })
      )
    } catch {
      // no permission, offline, or the route is not deployed yet — the app
      // falls back to the bundled photographs, which is the old behaviour
    } finally {
      snapshot = { ready: true, photos }
      publish()
    }
  })()
  return loading
}

/** Drops the cache so the next read re-fetches. Called after a change. */
function invalidate() {
  photos.clear()
  loading = null
  snapshot = { ready: false, photos }
  publish()
  return load()
}

const getSnapshot = () => snapshot

/**
 * The company photograph for this type, or null.
 *
 * Returns null both while loading and when there is none, on purpose: the
 * caller falls back to the bundled photograph either way, so a fleet list
 * renders immediately rather than holding a blank space for the network.
 */
export function useTypePhoto(vehicleType) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return (vehicleType && state.photos.get(vehicleType)) || null
}

/** Every type this company has supplied a photo for, for the admin screen. */
export function useTypePhotos() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export async function uploadTypePhoto(vehicleType, file) {
  const form = new FormData()
  form.append("photo", file, file.name || "vehicle.png")
  await postForm(`${ENDPOINT}/${encodeURIComponent(vehicleType)}/photo`, form)
  await invalidate()
}

export async function removeTypePhoto(vehicleType) {
  await del(`${ENDPOINT}/${encodeURIComponent(vehicleType)}/photo`)
  await invalidate()
}
