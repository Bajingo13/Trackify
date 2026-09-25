/**
 * MapLibre's popup API accepts HTML rather than React nodes. Any value coming
 * from a trip, stop, driver, or vehicle record must pass through this helper
 * before interpolation so an editable label can never become executable HTML.
 */
export function escapePopupHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char],
  );
}

export function popupText(value) {
  return `<span>${escapePopupHtml(value)}</span>`;
}
