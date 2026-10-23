import { useState } from "react";
import { currentDriverId } from "./driverApi";
import { cachedEmergencyLine, dialHref } from "./emergencyLine";
import { tap } from "./native";

/** The national emergency number, offered alongside — or instead of — the company's line. */
export const NATIONAL_EMERGENCY = "911";

const phoneIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

/**
 * Who to call, at the top of the Emergency screens.
 *
 * Read from the copy kept on the phone (emergencyLine.js), never fetched here,
 * so it is the same with signal or without. The Call button is a tel: link: it
 * opens the dialler with the number filled in and the driver presses call.
 * Nothing is dialled for them.
 *
 * A demo number (development servers only) says so in words, next to the
 * number. With no company line — none set, or none loaded on this phone yet —
 * 911 is the button, and the card says why.
 */
export default function EmergencyLineCard() {
  const [line] = useState(() => cachedEmergencyLine(currentDriverId()));
  const company = line?.number ? dialHref(line.number) : null;
  const national = dialHref(NATIONAL_EMERGENCY);

  return (
    <section className="dr-emline" aria-label="Emergency line">
      <div className="dr-emline-head">
        <span className="dr-emline-title">Emergency line</span>
        {company && line.isDemo && <span className="dr-emline-demo">Demo number, not a real hotline</span>}
      </div>

      {company ? (
        <>
          <div className="dr-emline-number">{line.number}</div>
          <a className="dr-btn dr-emline-call" href={company} onClick={() => tap("heavy")} aria-label={`Call ${line.number}`}>
            {phoneIcon}
            Call {line.number}
          </a>
          <a className="dr-emline-alt" href={national} onClick={() => tap("heavy")} aria-label={`Call ${NATIONAL_EMERGENCY}`}>
            Someone hurt? Call {NATIONAL_EMERGENCY}
          </a>
        </>
      ) : (
        <>
          <p className="dr-emline-note">
            {line
              ? "Your company has not set an emergency line yet."
              : "Your company's emergency line has not loaded on this phone yet. Open the app with signal once and it will be kept here."}
          </p>
          <a className="dr-btn dr-emline-call" href={national} onClick={() => tap("heavy")} aria-label={`Call ${NATIONAL_EMERGENCY}`}>
            {phoneIcon}
            Call {NATIONAL_EMERGENCY}
          </a>
        </>
      )}
    </section>
  );
}
