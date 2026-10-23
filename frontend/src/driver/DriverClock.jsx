import { useEffect, useState } from "react"
import { firstName, greeting } from "./DriverBits"

export function formatDriverClock(date) {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function formatDriverDate(date) {
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
}

function isoDay(d) {
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The Today greeting: "Good morning, Paul" with the device's local time and
 * date beneath it. One ticking clock drives all three, so the greeting turns
 * over at noon and 18:00 and the date at midnight without a reload. Only the
 * first name is used here; Profile shows the full one.
 */
export default function DriverClock({ name }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="dr-hello">
      <div className="dr-hello-line" title={name || undefined}>
        <span className="dr-greet">{greeting(now)},</span>{" "}
        <span className="dr-greet-name">{firstName(name) || "Driver"}</span>
      </div>
      <div className="dr-when" title="Current device time">
        <time className="dr-when-date" dateTime={isoDay(now)}>{formatDriverDate(now)}</time>
        <span className="dr-when-sep" aria-hidden="true" />
        <time className="dr-when-time" dateTime={now.toISOString()}>{formatDriverClock(now)}</time>
      </div>
    </div>
  )
}
