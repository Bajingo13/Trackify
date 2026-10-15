/**
 * How the Driver App talks about a licence running out.
 *
 * The server decides what state a licence is in (shared/driverLicense.js on the
 * backend) and sends both the state and the days left; this only words it. The
 * phone's own clock is never used for the arithmetic — a device date can be
 * wrong by years, sometimes on purpose, and a warning a driver can silence by
 * changing their settings is not a warning.
 *
 * The 60-day window is the one the office, the reports and the reminders use.
 */

/** A DATE as the server sends it ('2027-01-15') shown as a day, without a timezone shifting it. */
export function fmtDate(value) {
  if (!value) return "—"
  const text = String(value)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(text)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" })
}

/** The card's one-line flag: a tone and the words. */
export function expiryTone(daysLeft) {
  if (daysLeft == null) return { tone: "none", say: "No expiry recorded" }
  if (daysLeft < 0) return { tone: "danger", say: `Expired ${Math.abs(daysLeft)} day${daysLeft === -1 ? "" : "s"} ago` }
  if (daysLeft === 0) return { tone: "danger", say: "Expires today" }
  if (daysLeft <= 60) return { tone: "warn", say: `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` }
  return { tone: "ok", say: `Valid for ${daysLeft} more days` }
}

/** none | valid | expiring | expired — the server's word, or worked out from the days left. */
export function licenceState(licence) {
  if (!licence) return "none"
  if (licence.state) return licence.state
  const days = licence.daysLeft
  if (days == null) return "none"
  if (days < 0) return "expired"
  return days <= 60 ? "expiring" : "valid"
}

/**
 * What a driver must be told about their licence, or null when there is nothing to say.
 * Today is still "expiring": the licence is good through its expiry date.
 */
export function licenceAttention(licence) {
  const state = licenceState(licence)
  if (state === "expired") {
    return {
      tone: "danger",
      title: "Your licence has expired",
      detail: `It expired on ${fmtDate(licence.expiry)}. You can't be assigned trips until your office records your renewed licence.`,
      short: expiryTone(licence.daysLeft).say,
    }
  }
  if (state === "expiring") {
    const days = licence.daysLeft
    return {
      tone: days <= 7 ? "danger" : "warn",
      title: days === 0 ? "Your licence expires today" : `Your licence expires in ${days} day${days === 1 ? "" : "s"}`,
      detail: `Renew it before ${fmtDate(licence.expiry)}, then give the new licence to your office.`,
      short: expiryTone(days).say,
    }
  }
  return null
}
