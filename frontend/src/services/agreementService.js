import { get, post } from "./apiClient"

/**
 * The Terms of Service and Data Privacy Policy, and whether this user has
 * accepted the version currently published.
 *
 * The document text is not held here. The server owns it, so the words a user
 * accepts and the words recorded against that acceptance cannot drift apart —
 * which is the whole point of storing a version string.
 *
 * The result is cached for the session because the gate sits inside the route
 * guard: without this it would ask again on every navigation, and a user would
 * pay for that on every click. The cache is dropped on acceptance and on sign
 * out, so a new session or a new version is always fetched fresh.
 */
let pending = null

export function loadAgreement() {
  if (!pending) {
    pending = get("/agreement")
      .then((res) => res.data)
      .catch((err) => {
        // Never cache a failure: a network blip would otherwise keep the gate
        // stuck for the rest of the session.
        pending = null
        throw err
      })
  }
  return pending
}

/** Records acceptance and updates the cached answer in place. */
export async function acceptAgreement() {
  const res = await post("/agreement/accept", {})
  const accepted = res.data || {}
  const document = await pending
  pending = Promise.resolve({ ...document, accepted: true, acceptedAt: accepted.acceptedAt })
  return accepted
}

/** Every acceptance this user has recorded — their right under section 4.7. */
export async function agreementHistory() {
  const res = await get("/agreement/history")
  return res.data || []
}

/** Called on sign out, so the next user does not inherit this answer. */
export function forgetAgreement() {
  pending = null
}
