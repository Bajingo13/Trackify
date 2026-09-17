import { get } from "../apiClient"

/**
 * Report figures, counted by the database.
 *
 * Every report screen used to fetch whole tables and add them up in the
 * browser — five thousand vehicles, five thousand drivers, five thousand
 * maintenance records, two thousand trips, on every load and every auto
 * refresh. That is fine on demo data and gets worse every week a real operator
 * uses it.
 *
 * These return the few dozen numbers the charts actually draw. The date range
 * goes to the server too, so filtering a report no longer means downloading
 * everything and discarding most of it.
 */

/** Only send a range the server will accept, so a half-typed date is ignored. */
function rangeQuery(from, to) {
  const iso = /^\d{4}-\d{2}-\d{2}$/
  const params = new URLSearchParams()
  if (iso.test(from || "")) params.set("from", from)
  if (iso.test(to || "")) params.set("to", to)
  const q = params.toString()
  return q ? `?${q}` : ""
}

/**
 * Vehicles, drivers and maintenance for the Fleet report.
 *
 * Company-scoped, exactly as the Fleet list screens are, so the report and the
 * screen behind it cannot disagree about how many trucks there are.
 */
export async function getFleetReport({ from, to } = {}) {
  const res = await get(`/reports/fleet${rangeQuery(from, to)}`)
  return res.data
}

/**
 * Trips and exceptions for the Operations report.
 *
 * Company- and branch-scoped, exactly as the Operations screens are.
 */
export async function getOperationsReport({ from, to } = {}) {
  const res = await get(`/reports/operations${rangeQuery(from, to)}`)
  return res.data
}

/**
 * Trip costs and the voucher pipeline for the Expense report.
 *
 * Company-scoped, matching the finance screens, which scope on company alone.
 */
export async function getExpenseReport({ from, to } = {}) {
  const res = await get(`/reports/expenses${rangeQuery(from, to)}`)
  return res.data
}

/**
 * Receivables, operating cost and the ledger position for the Financial
 * report. It has no date filter on screen, so it takes no range.
 */
export async function getFinancialReport() {
  const res = await get("/reports/financial")
  return res.data
}
