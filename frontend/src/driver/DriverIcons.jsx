/**
 * The Driver App's list icons: one stroke weight, one 24-unit grid, and one
 * tile they sit on (LeadIcon), so a claim, a request and a Profile setting
 * read as members of the same family. They are decoration — every row they
 * lead already says in words what it is — so they are hidden from screen
 * readers.
 */

const SHAPES = {
  // claims
  fuel: ["M3 22h12", "M4 9h10", "M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18", "M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.8a2 2 0 0 0-.6-1.4L18 5"],
  toll: ["M3 9a3 3 0 0 0 0 6v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2a3 3 0 0 0 0-6V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2Z", "M13 5v2", "M13 11v2", "M13 17v2"],
  parking: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M9 17V7h4a3 3 0 0 1 0 6H9"],
  meals: ["M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2", "M7 2v20", "M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"],
  lodging: ["M2 4v16", "M2 8h18a2 2 0 0 1 2 2v10", "M2 17h20", "M6 8v9"],
  repair: ["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8Z"],
  receipt: ["M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z", "M8 8h8", "M8 12h8", "M8 16h5"],
  // requests
  route: ["M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15", { c: [6, 19, 3] }, { c: [18, 5, 3] }],
  truck: ["M10 17h4V5H2v12h3", "M20 17h2v-3.3a4 4 0 0 0-1.2-2.9L19 9h-5", "M14 17h1", { c: [7.5, 17.5, 2.5] }, { c: [17.5, 17.5, 2.5] }],
  wallet: ["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1", "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"],
  phone: ["M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z", "M12 18h.01"],
  shield: ["M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z"],
  person: [{ c: [12, 8, 4] }, "M4 20a8 8 0 0 1 16 0"],
  question: [{ c: [12, 12, 10] }, "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"],
  // profile
  idcard: ["M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z", { c: [8, 11, 2] }, "M5 16a3 3 0 0 1 6 0", "M14 10h5", "M14 14h4"],
  call: ["M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"],
  key: [{ c: [7.5, 15.5, 5.5] }, "m21 2-9.6 9.6", "m15.5 7.5 3 3L22 7l-3-3"],
  mail: ["M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z", "m22 6-10 7L2 6"],
  building: ["M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z", "M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2", "M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2", "M10 6h4", "M10 10h4", "M10 14h4", "M10 18h4"],
  clock: [{ c: [12, 12, 10] }, "M12 6v6l4 2"],
  history: ["M3 12a9 9 0 1 0 9-9 9.8 9.8 0 0 0-6.7 2.7L3 8", "M3 3v5h5", "M12 7v5l4 2"],
  headset: ["M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"],
  moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9"],
}

/** Claim categories (DriverClaimForm CATEGORIES) to their icon. */
export const CLAIM_ICON = { fuel: "fuel", toll: "toll", parking: "parking", meals: "meals", lodging: "lodging", repair: "repair", misc: "receipt" }

/** Help & Support categories (supportKinds SUPPORT_CATEGORIES) to their icon. */
export const SUPPORT_ICON = { trip: "route", vehicle: "truck", payment: "wallet", app: "phone", safety: "shield", account: "person", other: "question" }

export function Icon({ name, size = 18 }) {
  const shape = SHAPES[name] || SHAPES.question
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {shape.map((part, i) => (typeof part === "string"
        ? <path key={i} d={part} />
        : <circle key={i} cx={part.c[0]} cy={part.c[1]} r={part.c[2]} />))}
    </svg>
  )
}

/**
 * The tile a list row starts with. `tone` follows the row's status (the same
 * tones as Badge), so a rejected claim's tile is red like its badge.
 */
export function LeadIcon({ name, tone = "info" }) {
  return (
    <span className="dr-lead-icon" data-tone={tone} aria-hidden="true">
      <Icon name={name} />
    </span>
  )
}
