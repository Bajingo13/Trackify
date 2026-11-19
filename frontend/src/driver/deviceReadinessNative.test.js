import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const android = (...parts) => path.resolve(
  process.cwd(),
  "../driver-app/android/app/src/main",
  ...parts,
)
const plugin = readFileSync(android("java/com/astreablue/trackify/driver/DeviceReadinessPlugin.java"), "utf8")
const activity = readFileSync(android("java/com/astreablue/trackify/driver/MainActivity.java"), "utf8")
const manifest = readFileSync(android("AndroidManifest.xml"), "utf8")

describe("native Android readiness contract", () => {
  it("registers the exact bridge used by the Driver App", () => {
    expect(plugin).toContain('@CapacitorPlugin(name = "DeviceReadiness")')
    expect(activity).toContain("registerPlugin(DeviceReadinessPlugin.class)")
  })

  it("checks permissions and battery policy without reading a GPS position", () => {
    expect(plugin).toContain("ACCESS_FINE_LOCATION")
    expect(plugin).toContain("ACCESS_BACKGROUND_LOCATION")
    expect(plugin).toContain("POST_NOTIFICATIONS")
    expect(plugin).toContain("isIgnoringBatteryOptimizations")
    expect(plugin).not.toMatch(/LocationManager|getLastKnownLocation|requestLocationUpdates|latitude|longitude/i)
  })

  it("opens settings without requesting the restricted battery exemption permission", () => {
    expect(plugin).toContain("ACTION_APPLICATION_DETAILS_SETTINGS")
    expect(plugin).toContain("ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS")
    expect(manifest).not.toContain("REQUEST_IGNORE_BATTERY_OPTIMIZATIONS")
  })
})
