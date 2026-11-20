import { useCallback, useEffect, useMemo, useState } from "react"
import { isNativeApp } from "../platform"
import { canShareLocation } from "./capabilities"
import { arrivalNotificationsAvailable, arrivalNotificationsEnabled } from "./arrivalNotifications"
import { onQueueChange, pendingCount } from "./offlineQueue"
import { checkNow, useNetStatus } from "./netStatus"
import { openLocationSettings, tracksInBackground } from "./tracking"
import { tap } from "./native"
import {
  openDeviceAppSettings,
  openDeviceBatterySettings,
  readDeviceReadiness,
} from "./deviceReadiness"

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
  const [device, setDevice] = useState(null)
  const [refreshing, setRefreshing] = useState(true)
  const native = isNativeApp()
  const background = tracksInBackground()
  const notifications = native && arrivalNotificationsAvailable()

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const [permission, waiting, , readiness] = await Promise.all([
        readLocationPermission(),
        pendingCount(ownerId),
        checkNow().catch(() => null),
        readDeviceReadiness(),
      ])
      setLocation(readiness?.foregroundLocation || permission)
      setQueue(waiting)
      setDevice(readiness)
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
      ? device
        ? device.backgroundLocation === "granted"
          ? { title: "Background tracking", state: "Allowed all the time", tone: "ok", detail: "Tracking can continue after the screen locks." }
          : { title: "Background tracking", state: location === "granted" ? "While app is open" : "Blocked", tone: location === "granted" ? "warn" : "danger", detail: "Choose Allow all the time so tracking continues while you drive.", action: "Open settings", fix: "app" }
        : background
          ? { title: "Background tracking", state: "Check on phone", tone: "neutral", detail: "This build supports it; Android will confirm permission when sharing starts." }
        : { title: "Background tracking", state: "Unavailable", tone: "danger", detail: "This build can track only while the app is open." }
      : { title: "Background tracking", state: "App open only", tone: "neutral", detail: "Install the Android app to keep tracking after the screen locks." }

    const queueRow = queue.total > 0
      ? { title: "Saved work", state: queueLabel(queue.total), tone: "warn", detail: "Kept on this phone and sent automatically when Trackify reconnects." }
      : { title: "Saved work", state: "All sent", tone: "ok", detail: "Nothing is waiting on this phone." }

    const result = [connection, locationRow, backgroundRow, queueRow]
    if (native) {
      result.push(device?.batteryOptimization === "unrestricted" || device?.batteryOptimization === "not_applicable"
        ? { title: "Battery use", state: "Unrestricted", tone: "ok", detail: "Android is not limiting Trackify in the background." }
        : device?.batteryOptimization === "optimized"
          ? { title: "Battery use", state: "Restricted", tone: "warn", detail: "Battery optimization may stop tracking after the screen locks.", action: "Open battery settings", fix: "battery" }
          : { title: "Battery use", state: "Check unavailable", tone: "neutral", detail: "Confirm Trackify is unrestricted in Android battery settings." })
    }
    if (notifications) {
      result.push(device?.notifications === "denied"
        ? { title: "Arrival notifications", state: "Blocked", tone: "warn", detail: "Android notifications are off for Trackify.", action: "Open settings", fix: "app" }
        : arrivalNotificationsEnabled()
          ? { title: "Arrival notifications", state: "On", tone: "ok", detail: "This phone can alert you near the delivery point." }
        : { title: "Arrival notifications", state: "Off", tone: "neutral", detail: "Optional. Turn it on from the Notifications section in Profile." })
    }
    return result
  }, [background, device, location, native, network, notifications, queue.total])

  const fix = (kind) => {
    const open = kind === "battery"
      ? openDeviceBatterySettings
      : device
        ? openDeviceAppSettings
        : openLocationSettings
    tap("light")
    void open().then(refresh)
  }

  return (
    <div className="dr-device-status">
      <section className="dr-device-list dr-profile-box" aria-label="App and device checks" aria-live="polite">
        {rows.map((row) => (
          <div className="dr-device-row" key={row.title} data-tone={refreshing ? "neutral" : row.tone} data-loading={refreshing ? "yes" : "no"}>
            <span className="dr-device-copy">
              <span className="dr-device-row-head">
                <strong>{row.title}</strong>
                <span className="dr-device-status-badge">
                  <span className="dr-device-status-mark" aria-hidden="true" />
                  <span>{refreshing ? "Checking…" : row.state}</span>
                </span>
              </span>
              <small>{refreshing ? "Please wait for the latest result." : row.detail}</small>
              {!refreshing && row.action && (
                <button type="button" onClick={() => fix(row.fix || "app")}>
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
