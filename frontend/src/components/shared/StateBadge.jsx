/**
 * One status pill for the whole Fleet module.
 *
 * Every fleet page used to carry its own hardcoded pastel map, so the same
 * status looked different from page to page and none of them survived dark
 * mode. Tone is derived from meaning, not from the page, and every colour
 * comes from the token set.
 */

const TONES = {
  ok:     { fg: "var(--ok)",     bg: "var(--ok-soft)",     bd: "var(--ok-line)" },
  warn:   { fg: "var(--warn)",   bg: "var(--warn-soft)",   bd: "var(--warn-line)" },
  danger: { fg: "var(--danger)", bg: "var(--danger-soft)", bd: "var(--danger-line)" },
  accent: { fg: "var(--accent)", bg: "var(--accent-soft)", bd: "var(--accent-line)" },
  muted:  { fg: "var(--text-3)", bg: "var(--surface-sunk)", bd: "var(--line)" },
};

/** status text -> meaning, shared by vehicles, drivers, maintenance and availability */
const STATE_TONE = {
  // good to go / finished cleanly
  Available: "ok",
  Valid: "ok",
  Completed: "ok",
  // in play
  Assigned: "accent",
  Reserved: "accent",
  Scheduled: "accent",
  "On Trip": "accent",
  "In Progress": "accent",
  // needs attention soon
  Due: "warn",
  "Expiring Soon": "warn",
  "On Leave": "warn",
  // problem
  Overdue: "danger",
  Expired: "danger",
  Maintenance: "danger",
  // out of service, not a problem
  Inactive: "muted",
  Unavailable: "muted",
  Retired: "muted",
  Cancelled: "muted",
};

export function toneFor(status) {
  return STATE_TONE[status] || "muted";
}

export default function StateBadge({ status, tone, title }) {
  const t = TONES[tone || toneFor(status)] || TONES.muted;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 9px",
        borderRadius: "var(--r-pill)",
        fontSize: "var(--fs-11)",
        fontWeight: 600,
        whiteSpace: "nowrap",
        color: t.fg,
        background: t.bg,
        border: `1px solid ${t.bd}`,
      }}
    >
      {status}
    </span>
  );
}
