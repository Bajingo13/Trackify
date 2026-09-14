import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The native shell around the driver app.
 *
 * `www` is not source — it is written by `npm --prefix ../frontend run
 * build:driver` and copied into the Android/iOS projects by `cap sync`. Edit
 * the driver app under frontend/src/driver, never here.
 */
const config: CapacitorConfig = {
  appId: 'com.astreablue.trackify.driver',
  appName: 'Trackify Driver',
  webDir: 'www',

  // Pinned rather than left to the default, because the API has to allow this
  // exact origin: the webview presents `https://localhost` on every request,
  // and the backend's CORS policy names it. A silent change of default here
  // would break sign-in with nothing but "Failed to fetch" to go on.
  server: {
    androidScheme: 'https',
  },

  android: {
    // Trips, receipts and delivery photos all go over the network; there is no
    // case where a plaintext request is expected, and disallowing it means a
    // misconfigured API URL fails loudly instead of sending a driver's
    // signature in the clear.
    allowMixedContent: false,

    // Required by @capacitor-community/background-geolocation: without it
    // Android halts location updates about five minutes after the app goes to
    // the background, which is the exact window the plugin exists to cover.
    // The plugin documents this as a hard requirement rather than a tuning
    // knob (capacitor-community/background-geolocation#89).
    //
    // It changes how the webview is served — the legacy interceptor instead of
    // WebViewAssetLoader — but not the origin, which androidScheme still pins
    // to https://localhost, so the CORS allowlist is unaffected.
    useLegacyBridge: true,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#0f172a',
      showSpinner: false,
    },
  },
}

export default config
