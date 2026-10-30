import { licenceAttention } from "./licenceExpiry"
import { tap } from "./native"
import NetSign from "./NetSign"
import NoticePortal from "./NoticePortal"

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
    <NoticePortal>
      <NetSign
        tone={attention.tone}
        icon="idcard"
        label={attention.title}
        detail={attention.detail}
        action={{ label: "View", onClick: () => { tap("light"); onOpen?.() } }}
        minimizable
      />
    </NoticePortal>
  )
}
