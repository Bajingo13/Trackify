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

  android: {
    // Trips, receipts and delivery photos all go over the network; there is no
    // case where a plaintext request is expected, and disallowing it means a
    // misconfigured API URL fails loudly instead of sending a driver's
    // signature in the clear.
    allowMixedContent: false,
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
