import { useCallback, useEffect, useMemo, useState } from "react"
import { isNativeApp } from "../platform"
import { canShareLocation } from "./capabilities"
import { arrivalNotificationsAvailable, arrivalNotificationsEnabled } from "./arrivalNotifications"
import { onQueueChange, pendingCount } from "./offlineQueue"
import { checkNow, useNetStatus } from "./netStatus"
import { openLocationSettings, tracksInBackground } from "./tracking"
import { tap } from "./native"

async function readLocationPermission() {
  if (!canShareLocation()) return "unavailable"
  if (!navigator.permissions?.query) return "unknown"
  try {
    const result = await navigator.permissions.query({ name: "geolocation" })
    return result?.state || "unknown"
  } catch {
    return "unknown"
  }
}

const queueLabel = (count) => `${count} record${count === 1 ? "" : "s"} waiting`

/**
 * A small pre-drive health check. Every value is read locally from capabilities
 * the app already uses; no location, customer data, token or PIN is collected.
 */
export default function DriverDeviceStatus({ ownerId }) {
  const network = useNetStatus()
  const [location, setLocation] = useState("checking")
  const [queue, setQueue] = useState({ total: 0, records: 0, pings: 0, trail: 0 })
  const [refreshing, setRefreshing] = useState(true)
  const native = isNativeApp()
  const background = tracksInBackground()
  const notifications = native && arrivalNotificationsAvailable()

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const [permission, waiting] = await Promise.all([
        readLocationPermission(),
        pendingCount(ownerId),
        checkNow().catch(() => null),
      ])
      setLocation(permission)
      setQueue(waiting)
    } finally {
      setRefreshing(false)
    }
  }, [ownerId])

  useEffect(() => {
    let active = true
    const update = () => refresh().catch(() => {})
    void update()
    const stopQueue = onQueueChange(update)
    const onVisible = () => { if (document.visibilityState === "visible" && active) void update() }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      active = false
      stopQueue()
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [refresh])

  const rows = useMemo(() => {
    const connection = network === "online"
      ? { title: "Trackify connection", state: "Connected", tone: "ok", detail: "The server is responding normally." }
      : network === "unstable"
        ? { title: "Trackify connection", state: "Unstable", tone: "warn", detail: "The link is slow. Saved work will retry automatically." }
        : { title: "Trackify connection", state: "Offline", tone: "danger", detail: "No server connection. Supported trip work stays on this phone." }

    const locationRow = location === "granted"
      ? { title: "Location access", state: "Allowed", tone: "ok", detail: "Trackify can read GPS while you share a trip." }
      : location === "denied"
        ? { title: "Location access", state: "Blocked", tone: "danger", detail: "Allow location in phone settings before sharing a trip.", action: native ? "Open settings" : undefined }
        : location === "unavailable"
          ? { title: "Location access", state: "Unavailable", tone: "danger", detail: "This browser or connection cannot provide GPS location." }
          : location === "checking"
            ? { title: "Location access", state: "Checking", tone: "neutral", detail: "Reading this phone’s permission." }
            : { title: "Location access", state: "Check on start", tone: "neutral", detail: "The phone will confirm permission when location sharing starts." }

    const backgroundRow = native
      ? background
        ? { title: "Background tracking", state: "Supported", tone: location === "denied" ? "warn" : "ok", detail: "Can continue with the screen locked when Android is set to Allow all the time." }
        : { title: "Background tracking", state: "Unavailable", tone: "danger", detail: "This build can track only while the app is open." }
      : { title: "Background tracking", state: "App open only", tone: "neutral", detail: "Install the Android app to keep tracking after the screen locks." }

    const queueRow = queue.total > 0
      ? { title: "Saved work", state: queueLabel(queue.total), tone: "warn", detail: "Kept on this phone and sent automatically when Trackify reconnects." }
      : { title: "Saved work", state: "All sent", tone: "ok", detail: "Nothing is waiting on this phone." }

    const result = [connection, locationRow, backgroundRow, queueRow]
    if (notifications) {
      result.push(arrivalNotificationsEnabled()
        ? { title: "Arrival notifications", state: "On", tone: "ok", detail: "This phone can alert you near the delivery point." }
        : { title: "Arrival notifications", state: "Off", tone: "neutral", detail: "Optional. Turn it on from the Notifications section in Profile." })
    }
    return result
  }, [background, location, native, network, notifications, queue.total])

  return (
    <div className="dr-device-status">
      <section className="dr-device-list dr-profile-box" aria-label="App and device checks" aria-live="polite">
        {rows.map((row) => (
          <div className="dr-device-row" key={row.title} data-tone={refreshing ? "neutral" : row.tone} data-loading={refreshing ? "yes" : "no"}>
            <span className="dr-device-dot" aria-hidden="true" />
            <span className="dr-device-copy">
              <span className="dr-device-row-head">
                <strong>{row.title}</strong>
                <span>{refreshing ? "Checking…" : row.state}</span>
              </span>
              <small>{refreshing ? "Please wait for the latest result." : row.detail}</small>
              {!refreshing && row.action && (
                <button type="button" onClick={() => { tap("light"); void openLocationSettings().then(refresh) }}>
                  {row.action}
                </button>
              )}
            </span>
          </div>
        ))}
      </section>

      <p className="dr-device-privacy">This check stays on your phone. It does not read your PIN or trip locations.</p>
      <button type="button" className="dr-btn ghost dr-device-refresh-button" disabled={refreshing} onClick={() => { tap("light"); void refresh() }}>
        {refreshing ? "Refreshing status…" : "Refresh status"}
      </button>
    </div>
  )
}

export { readLocationPermission }
