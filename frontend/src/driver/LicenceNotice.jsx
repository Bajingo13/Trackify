import { licenceAttention } from "./licenceExpiry"
import { tap } from "./native"

/**
 * Tells the driver, on the first screen they see, that their licence is
 * expiring or has expired.
 *
 * The licence card inside Profile already shows this, but only to a driver who
 * goes looking — and the one who needs it most is the one who has stopped
 * looking. Renders nothing while the licence is fine, so it is news when it
 * appears.
 */
export default function LicenceNotice({ licence, onOpen }) {
  const attention = licenceAttention(licence)
  if (!attention) return null

  return (
    <div className="dr-licnote" data-tone={attention.tone} role="status">
      <div className="dr-licnote-copy">
        <div className="dr-licnote-title">{attention.title}</div>
        <div className="dr-licnote-sub">{attention.detail}</div>
      </div>
      <button type="button" className="dr-licnote-go" onClick={() => { tap("light"); onOpen?.() }}>
        View
      </button>
    </div>
  )
}
