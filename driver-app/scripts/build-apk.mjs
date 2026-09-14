/**
 * Builds an installable debug APK and says where it is.
 *
 *   npm run apk
 *
 * Wraps the Gradle build so nobody has to remember the task name or go hunting
 * through build/outputs for the file. Checks the toolchain first, because the
 * failure Gradle gives for a missing JDK or SDK is not one you can act on.
 */
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ANDROID = path.resolve(HERE, "..", "android")
const APK = path.join(
  ANDROID,
  "app/build/outputs/apk/debug/app-debug.apk",
)

function fail(what, fix) {
  console.error(`\n  ${what}\n\n  ${fix}\n`)
  process.exit(1)
}

if (!existsSync(ANDROID)) {
  fail(
    "There is no android/ folder yet.",
    "Run:  npx cap add android",
  )
}

const java = spawnSync("java", ["-version"], { encoding: "utf8" })
if (java.error) {
  fail(
    "Java is not installed, and Android builds need it.",
    "Install Temurin JDK 21 from https://adoptium.net, then open a NEW terminal and try again.",
  )
}

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
const localProps = path.join(ANDROID, "local.properties")
if (!sdk && !existsSync(localProps)) {
  fail(
    "The Android SDK cannot be found.",
    "Install Android Studio from https://developer.android.com/studio, open it once so it\n" +
      "  downloads the SDK, then set ANDROID_HOME to (for example)\n" +
      "  C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk  and open a NEW terminal.",
  )
}

console.log("Building the driver bundle and syncing it into Android…\n")
const sync = spawnSync("npm", ["run", "sync"], {
  cwd: path.resolve(HERE, ".."),
  stdio: "inherit",
  shell: process.platform === "win32",
})
if (sync.status !== 0) process.exit(sync.status ?? 1)

console.log("\nBuilding the APK — the first run downloads Gradle and takes a while.\n")
const gradlewPath = path.join(
  ANDROID,
  process.platform === "win32" ? "gradlew.bat" : "gradlew",
)
// Quoted because a .bat can only be spawned through a shell on Windows, and a
// shell splits an unquoted path on its spaces.
const gradlew =
  process.platform === "win32" ? `"${gradlewPath}"` : gradlewPath
const build = spawnSync(gradlew, ["assembleDebug"], {
  cwd: ANDROID,
  stdio: "inherit",
  shell: process.platform === "win32",
})
if (build.status !== 0) process.exit(build.status ?? 1)

if (!existsSync(APK)) {
  fail(
    "Gradle reported success but the APK is not where it was expected.",
    `Look under ${path.join(ANDROID, "app/build/outputs/apk")}`,
  )
}

console.log(`
  APK ready:

    ${APK}

  Copy that file to your phone — Drive, email, or over USB — and tap it there.
  Android will warn about installing outside the Play Store and offer a
  settings link; allow "Install unknown apps" for whichever app you used to
  download it, then tap the file again.
`)
