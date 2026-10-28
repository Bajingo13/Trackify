import { useLayoutEffect, useState } from "react"
import { createPortal } from "react-dom"

/**
 * Places app-level notices in DriverApp's fixed top layer. The inline fallback
 * keeps isolated screens and tests usable when that shell is not mounted.
 */
export default function NoticePortal({ children }) {
  const findHost = () => typeof document === "undefined" ? null : document.querySelector(".dr-netlayer")
  const [host, setHost] = useState(findHost)

  useLayoutEffect(() => {
    const next = findHost()
    if (next !== host) setHost(next)
  }, [host])

  return host ? createPortal(children, host) : children
}
