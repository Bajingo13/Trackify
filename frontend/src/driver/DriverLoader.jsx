/**
 * Full-screen hand-off shown for a moment after the driver signs in and after
 * they sign out: a ring of dashes turning, like road markings, over the app's
 * own background. It carries no controls and swallows taps, so nothing behind
 * it can be pressed while the screen changes.
 */
export default function DriverLoader({ label }) {
  return (
    <div className="dr-loader" role="status" aria-label={label}>
      <svg className="dr-loader-ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="38" />
      </svg>
    </div>
  );
}
