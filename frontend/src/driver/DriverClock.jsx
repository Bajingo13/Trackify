import { useEffect, useState } from "react"

export function formatDriverClock(date) {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })
}

/** The driver's local device time, kept current while the Today screen is open. */
export default function DriverClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="dr-live-clock" title="Current device time">
      <time dateTime={now.toISOString()}>{formatDriverClock(now)}</time>
    </div>
  )
}
