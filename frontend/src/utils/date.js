/**
 * Timezone-safe date helpers.
 *
 * Backend DATE columns arrive as plain 'YYYY-MM-DD' strings — those are calendar
 * dates and must never be run through `new Date(str)` (which parses as UTC
 * midnight and then shifts in the viewer's timezone). DATETIME/TIMESTAMP columns
 * arrive as ISO strings and DO represent a real instant, so those format normally.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Display a date value as a short local date string. */
export function formatDate(value) {
  if (!value) return "—";
  const s = String(value);
  const m = s.match(DATE_ONLY);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/** Value for an <input type="date"> — always 'YYYY-MM-DD'. */
export function dateInputValue(value) {
  if (!value) return "";
  const s = String(value);
  if (DATE_ONLY.test(s)) return s;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  // local Y-M-D, not toISOString (which would be UTC)
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Today's date as 'YYYY-MM-DD' in the viewer's timezone. */
export function todayInput() {
  return dateInputValue(new Date());
}
