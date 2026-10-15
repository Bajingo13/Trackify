/**
 * How Help & Support reads to a driver: what a request can be about, and where
 * a request stands, in their words. The server stores the codes.
 */

export const SUPPORT_CATEGORIES = [
  { value: "trip", label: "Trip or dispatch" },
  { value: "vehicle", label: "Truck problem" },
  { value: "payment", label: "Pay or expenses" },
  { value: "app", label: "App or sign-in" },
  { value: "safety", label: "Safety" },
  { value: "account", label: "My account" },
  { value: "other", label: "Something else" },
];

export const categoryLabel = (value) => SUPPORT_CATEGORIES.find((c) => c.value === value)?.label || "Something else";

/** Status as the driver reads it, and the tone its badge takes. */
export const SUPPORT_STATUS = {
  open: { label: "Sent", tone: "wait" },
  in_progress: { label: "Being handled", tone: "info" },
  resolved: { label: "Resolved", tone: "ok" },
  closed: { label: "Closed", tone: "neutral" },
};

/** Still being worked on: shown under Requests. Everything else is finished and lives in History. */
export const ticketIsActive = (ticket) => ticket?.status === "open" || ticket?.status === "in_progress";

/**
 * Whose move it is on a request still being worked: "office" when the driver wrote last and is
 * waiting, "driver" when the office has answered. Null for a finished request.
 */
export const turnOf = (ticket) => (ticketIsActive(ticket) ? (ticket.lastSender === "staff" ? "driver" : "office") : null);

/**
 * How a finished request ended, in the driver's words. A pause request ends in what happened
 * to the delivery (resumed, declined, withdrawn); anything else ends as resolved or closed.
 */
export function outcomeOf(ticket) {
  const pause = ticket?.pause;
  if (pause && PAUSE_STATUS[pause.status]) return PAUSE_STATUS[pause.status];
  return SUPPORT_STATUS[ticket?.status] || SUPPORT_STATUS.closed;
}

/* ---- pause requests ---- */

/** What stopped the delivery. The server stores the code; the driver reads the label and the hint. */
export const PAUSE_REASONS = [
  { value: "breakdown", label: "Vehicle breakdown", hint: "Engine, tyre, brakes or any fault that stops the truck." },
  { value: "emergency", label: "Emergency", hint: "Someone is hurt, or you are in danger." },
  { value: "incident", label: "Unexpected incident", hint: "An accident, a blocked or flooded road, a security problem." },
  { value: "delay", label: "Delivery delay", hint: "Heavy traffic, weather, a closure, a long wait at a gate." },
  { value: "other", label: "Other concern", hint: "Something else that keeps you from going on." },
];

export const pauseReasonLabel = (value) => PAUSE_REASONS.find((r) => r.value === value)?.label || "Other concern";

/** Where a pause request stands, in the driver's words, and the tone its badge takes. */
export const PAUSE_STATUS = {
  pending: { label: "Waiting for review", tone: "wait" },
  approved: { label: "Approved: delivery paused", tone: "info" },
  declined: { label: "Declined", tone: "danger" },
  resumed: { label: "Resumed", tone: "ok" },
  cancelled: { label: "Withdrawn", tone: "neutral" },
};

/** A pause is "live" while the office has yet to answer it, or has approved it and the delivery is held. */
export const pauseIsLive = (pause) => pause?.status === "pending" || pause?.status === "approved";

/**
 * What a run's status chip says, and the class it takes.
 *
 * A pause never changes the trip's status (it stays in_transit underneath), so
 * an in-transit run with a pause in force reads "Paused", and one whose pause
 * is still with the office reads "Pause requested": the truck is stopped, and
 * saying "In transit" would tell the driver, at a glance, the opposite.
 */
export function runStatus(status, pauseStatus) {
  if (status === "in_transit" && pauseStatus === "approved") return { label: "Paused", key: "paused" };
  if (status === "in_transit" && pauseStatus === "pending") return { label: "Pause requested", key: "pause_pending" };
  return { label: String(status || "").replace(/_/g, " "), key: status };
}

/** "42 min", "1 h 5 min": how long a delivery was held. */
export function formatMinutes(min) {
  if (min == null) return null;
  if (min < 1) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** A device-chosen id that makes a replayed send harmless. */
export function newClientRef() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* fall through */ }
  return `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
