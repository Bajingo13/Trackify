# Trackify Driver — native app

The driver app as an installable Android app, wrapping the exact same code that
runs on the web at `/driver`. There is **one** driver app in this repository.
It ships two ways.

```
frontend/src/driver/          the driver app — the only place to edit it
  ├── used by frontend/src/App.jsx          → the website, at /driver
  └── used by frontend/src/driver-main.jsx  → this native app

driver-app/                   the native shell (no app code of its own)
  ├── www/                    built driver bundle — generated, never edited
  └── android/                the Android project: manifest, icons, permissions
```

A bug fixed in `frontend/src/driver` is fixed in both. There is no second copy
to keep in step.

---

## What you need installed, once

Nothing here needs a Mac unless you later want iOS.

| What | Why | Where |
| --- | --- | --- |
| **JDK 21** | Android builds run on Java | [adoptium.net](https://adoptium.net) — pick Temurin 21, LTS |
| **Android Studio** | Brings the Android SDK, the emulator, and the build tools | [developer.android.com/studio](https://developer.android.com/studio) |

After installing Android Studio, open it once and let it finish downloading the
SDK — it prompts on first launch. Then check that these two are set, in a **new**
terminal:

```powershell
java -version          # should say 21
$env:ANDROID_HOME      # should print a path ending in \Android\Sdk
```

If `ANDROID_HOME` is empty, set it (System Properties → Environment Variables):

```
ANDROID_HOME = C:\Users\<you>\AppData\Local\Android\Sdk
```

It is roughly a 2 GB download in total, and it is a one-time cost.

---

## Build and run it

From `driver-app/`:

```bash
npm install              # once
npm run run:android      # builds the driver bundle, syncs it, launches the app
```

That single command does three things: builds the driver web bundle into `www/`,
copies it into the Android project, then compiles and installs the app on
whichever device or emulator is connected.

To open the project in Android Studio instead — needed for signing a release, or
to use its emulator manager:

```bash
npm run open:android
```

| Command | What it does |
| --- | --- |
| `npm run sync` | Rebuild the bundle and copy it into the native project |
| `npm run run:android` | `sync`, then build and launch on a device/emulator |
| `npm run open:android` | Open the Android project in Android Studio |
| `npm run apk` | Build an installable APK file and print where it landed |
| `npm run doctor` | Check the toolchain and report what is missing |

**Run `npm run sync` after every change to the driver app.** The native app
loads a copy of the bundle; without a sync you are running the previous build.

---

## Getting it onto your own phone

### First, point it at the deployed API

Do this before building, or the app will install and then fail to sign in. In
the root `.env`:

```ini
VITE_DRIVER_API_URL=https://trackify-backend-production-a447.up.railway.app
```

Use the deployed backend rather than your PC. An APK built against
`http://192.168.x.x:5000` only works on your wifi, and the app refuses
plaintext requests anyway (`allowMixedContent: false`). Pointed at Railway it
works anywhere, on mobile data, with your PC switched off.

### Then pick one of two ways

**A — cable, and it installs itself.** Easiest if the phone is to hand.

1. On the phone: Settings → About phone → tap **Build number** seven times.
   That unlocks Developer options.
2. Settings → System → Developer options → turn on **USB debugging**.
3. Plug the phone into the PC. It shows a prompt — allow the connection.
4. `npm run run:android`

The app builds, installs and opens by itself. Re-run that one command after
every change.

**B — an APK file you can download.** Use this if the phone is somewhere else,
or you want to send it to a driver to try.

1. `npm run apk`
2. It prints the file's location:
   `android/app/build/outputs/apk/debug/app-debug.apk`
3. Get that file to the phone — Google Drive, email it to yourself, or copy it
   over USB. Whatever is easiest.
4. Tap it on the phone. Android will say the file type can be harmful and
   offer a settings link: allow **Install unknown apps** for whichever app you
   downloaded it with (Drive, Gmail, Files), then tap it again.
5. It installs like any app, with its own icon.

That warning is normal — it appears for every app not installed from the Play
Store, and it goes away once the app is published.

This is a **debug** APK: fine for testing and for handing to a driver, not
publishable. A release build needs signing — see the last section.

---

## Pointing it at your API

This is the one thing that differs from the website, and the most common reason
a fresh build appears to do nothing.

On the web the app just asks the page's own origin for the API. Inside the
native app there is no such origin — `localhost` in the webview means the phone
itself. So the API has to be named outright, in the root `.env`:

```ini
# release build, against the deployed backend
VITE_DRIVER_API_URL=https://trackify-backend-production-a447.up.railway.app

# Android emulator talking to the API on this PC
VITE_DRIVER_API_URL=http://10.0.2.2:5000

# a real phone on the same wifi as this PC
VITE_DRIVER_API_URL=http://192.168.68.60:5000
```

`10.0.2.2` is not a typo — it is the fixed address the Android emulator uses to
reach the host machine.

The value is baked in at build time, so **change it and run `npm run sync`
again**.

One catch on a real phone with a plain `http://` address: the app sets
`allowMixedContent: false`, so Android blocks plaintext requests. For testing
against a local API on a device, either use the emulator, or put the backend
behind an https tunnel (the frontend's Vite config already allows Cloudflare and
ngrok hosts).

---

## What the native app gains today

- **Location works, always.** On the web, GPS needs an https origin — which is
  why opening the app from a phone over `http://192.168.x.x` silently withheld
  it. The native webview is always a secure context, so that whole class of
  problem is gone.
- **A real installed app**, with its own icon and launcher entry, no browser
  chrome, and no "add to home screen" instructions for the driver.
- **Portrait locked**, no accidental pinch-zoom mid-delivery.

## What it does not do yet — read this before promising it

**The trail still stops when the screen locks.** The app tracks with the web
`watchPosition` API, which Android throttles and eventually kills once the app
is backgrounded. So the dispatcher sees the truck while the driver has the app
open and the screen on, and not otherwise.

Fixing that properly needs three things, and they belong together:

1. A background-geolocation plugin. `@transistorsoft/capacitor-background-geolocation`
   is paid (~$300 one-off) and is the one built for fleet work — it handles the
   battery-optimisation and OEM process-killer problems that matter most on the
   budget Android handsets common in Philippine trucking (Xiaomi, Oppo, Vivo and
   Realme all kill background services aggressively, each needing its own
   whitelisting prompt). `@capacitor-community/background-geolocation` is the
   free alternative and is noticeably less robust.
2. The three permissions left commented out in `AndroidManifest.xml`:
   `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`,
   `FOREGROUND_SERVICE_LOCATION`.
3. A Play Store justification and demo video for background location. Google
   rejects apps that request it without one, so this is a submission
   requirement, not paperwork to do later.

Budget the OEM battery fight, not the plugin install. The install is an
afternoon; making the trail survive a Xiaomi overnight is the actual work.

---

## Releasing to the Play Store

Not set up yet, and not needed to test. When you get there:

1. Google Play developer account — $25, one-off.
2. Generate an upload keystore and keep it somewhere it cannot be lost —
   **lose it and you cannot update the app**, only publish a new listing.
3. `npm run open:android`, then Build → Generate Signed App Bundle.
4. Play requires a privacy policy URL for any app touching location.

iOS needs a Mac and $99/year. Do Android first, and only add iOS if drivers
actually carry iPhones — background location there is stricter and roughly
doubles the work.
