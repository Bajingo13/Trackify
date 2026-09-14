/**
 * Builds a signed release bundle for the Play Store.
 *
 *   npm run release
 *
 * Play wants an .aab (Android App Bundle), not the .apk used for sideloading —
 * it slices the bundle per device rather than shipping every screen density and
 * architecture to every phone.
 *
 * Everything here that can fail does so with something you can act on. Gradle's
 * own message for a missing keystore is a stack trace ending in
 * "keystore file not set", which tells you nothing about what to create or
 * where to put it.
 */
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ANDROID = path.resolve(HERE, "..", "android")
const AAB = path.join(ANDROID, "app/build/outputs/bundle/release/app-release.aab")
const PROPS = path.join(ANDROID, "keystore.properties")

function fail(what, fix) {
  console.error(`\n  ${what}\n\n${fix}\n`)
  process.exit(1)
}

if (spawnSync("java", ["-version"], { encoding: "utf8" }).error) {
  fail(
    "Java is not installed, and Android builds need it.",
    "  Install Temurin JDK 21 from https://adoptium.net, then open a NEW terminal.",
  )
}

const hasEnvSigning =
  process.env.TRACKIFY_KEYSTORE_FILE && process.env.TRACKIFY_KEYSTORE_PASSWORD
if (!existsSync(PROPS) && !hasEnvSigning) {
  fail(
    "There is no signing key, so a release build would be unsigned — and an unsigned bundle cannot be uploaded to Play.",
    `  One-time setup:

    1. Create the key (from driver-app/android):

         keytool -genkey -v -keystore trackify-release.jks \\
             -keyalg RSA -keysize 2048 -validity 10000 -alias trackify

    2. Copy keystore.properties.example to keystore.properties and fill in
       the passwords you just chose.

    3. Back up trackify-release.jks somewhere off this machine.

  Keep that file. Play identifies the app by this key: lose it and you cannot
  update the listing, only publish a separate app under a new name.`,
  )
}

console.log("Building the driver bundle and syncing it into Android…\n")
const sync = spawnSync("npm", ["run", "sync"], {
  cwd: path.resolve(HERE, ".."),
  stdio: "inherit",
  shell: process.platform === "win32",
})
if (sync.status !== 0) process.exit(sync.status ?? 1)

console.log("\nBuilding the signed release bundle…\n")
const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew"
const build = spawnSync(gradlew, ["bundleRelease"], {
  cwd: ANDROID,
  stdio: "inherit",
  shell: process.platform === "win32",
})
if (build.status !== 0) process.exit(build.status ?? 1)

if (!existsSync(AAB)) {
  fail(
    "Gradle reported success but the bundle is not where it was expected.",
    `  Look under ${path.join(ANDROID, "app/build/outputs")}`,
  )
}

console.log(`
  Release bundle ready:

    ${AAB}

  Upload this at play.google.com/console. Before the first submission you will
  also need a privacy policy URL, and — because the app requests background
  location — a written justification and a short demo video showing why a
  dispatcher needs to see the vehicle while the driver is driving. Play rejects
  background location without them.
`)
