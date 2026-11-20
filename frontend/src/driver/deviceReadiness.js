import { isNativeApp } from "../platform"

const PLUGIN = "DeviceReadiness"

function readinessPlugin() {
  if (!isNativeApp()) return null
  const cap = globalThis.Capacitor
  const bridged = cap?.Plugins?.[PLUGIN]
  if (bridged) return bridged
  if (typeof cap?.registerPlugin !== "function") return null
  try {
    return cap.registerPlugin(PLUGIN)
  } catch {
    return null
  }
}

const permission = (value) => value === "granted" ? "granted" : "denied"

/** Android permission state only; never a location fix or driver record. */
export async function readDeviceReadiness() {
  const plugin = readinessPlugin()
  if (!plugin?.getStatus) return null
  try {
    const status = await plugin.getStatus()
    return {
      foregroundLocation: permission(status?.foregroundLocation),
      backgroundLocation: permission(status?.backgroundLocation),
      notifications: permission(status?.notifications),
      batteryOptimization: ["unrestricted", "optimized", "not_applicable"].includes(status?.batteryOptimization)
        ? status.batteryOptimization
        : "unknown",
    }
  } catch {
    return null
  }
}

export async function openDeviceAppSettings() {
  try {
    const result = await readinessPlugin()?.openAppSettings?.()
    return Boolean(result?.opened)
  } catch {
    return false
  }
}

export async function openDeviceBatterySettings() {
  try {
    const result = await readinessPlugin()?.openBatterySettings?.()
    return Boolean(result?.opened)
  } catch {
    return false
  }
}

export const deviceReadinessAvailable = () => Boolean(readinessPlugin())
