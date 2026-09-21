import { useCallback, useEffect, useState } from "react";
import { BellOff, Inbox } from "lucide-react";
import { SettingsPage, FormSection } from "../../../components/settings";
import { useToast } from "../../../components/shared/Toast";
import {
  getAlertPreferences,
  setAlertPreferences,
} from "../../../services/admin/settingsService";

/**
 * Which alerts reach you on the exceptions board.
 *
 * Mutes, not subscriptions. Every alert here is raised because something went
 * wrong on a trip, so the default has to be that you see it: nobody who has
 * never opened this page should be the one who missed a failed delivery.
 * Turning one off is a deliberate act, and it only ever affects your own view.
 *
 * There is no email or SMS column, because the system sends neither. A channel
 * you can tick that nothing delivers is worse than no channel at all.
 */

/* Grouped the way a dispatcher thinks about them rather than by column name. */
const GROUPS = [
  {
    title: "On the road",
    description: "Raised while a trip is running.",
    items: [
      { type: "trip_delay", label: "Trip delay", when: "A trip falls behind its scheduled arrival." },
      { type: "route_deviation", label: "Route deviation", when: "A vehicle leaves the planned route." },
      { type: "gps_offline", label: "GPS offline", when: "A vehicle stops reporting its position." },
    ],
  },
  {
    title: "Vehicle and driver",
    description: "Raised about the people and units on a trip.",
    items: [
      { type: "vehicle_breakdown", label: "Vehicle breakdown", when: "A driver reports the unit cannot continue." },
      { type: "vehicle_maintenance_block", label: "Maintenance block", when: "A unit is due for service and cannot be dispatched." },
      { type: "driver_license_issue", label: "Driver licence issue", when: "A licence has expired or is about to." },
      { type: "driver_declined", label: "Driver declined", when: "A driver turns down an assigned trip." },
    ],
  },
  {
    title: "Delivery and cargo",
    description: "Raised at the drop-off.",
    items: [
      { type: "failed_delivery", label: "Failed delivery", when: "A stop could not be completed." },
      { type: "cargo_shortage", label: "Cargo shortage", when: "Less was delivered than was loaded." },
      { type: "cargo_damage", label: "Cargo damage", when: "Goods arrived damaged." },
      { type: "missing_pod", label: "Missing proof of delivery", when: "A completed stop has no signature or photo." },
    ],
  },
  {
    title: "Planning",
    description: "Raised before a trip starts.",
    items: [
      { type: "schedule_conflict", label: "Schedule conflict", when: "A driver or unit is double-booked." },
    ],
  },
];

function Switch({ id, on, busy, onChange, label }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={() => onChange(!on)}
      style={{
        position: "relative", width: 40, height: 22, flexShrink: 0, padding: 0,
        borderRadius: "var(--r-pill)", cursor: busy ? "progress" : "pointer",
        border: `1px solid ${on ? "transparent" : "var(--line-strong)"}`,
        background: on ? "var(--accent)" : "var(--surface-sunk)",
        opacity: busy ? 0.6 : 1,
        transition: "background 140ms ease, border-color 140ms ease",
      }}
    >
      <span
        style={{
          position: "absolute", top: 2, left: on ? 20 : 2, width: 16, height: 16,
          borderRadius: "50%", background: on ? "var(--text-on-accent)" : "var(--text-3)",
          boxShadow: "var(--shadow-1)", transition: "left 140ms ease",
        }}
      />
    </button>
  );
}

export default function NotificationsPage() {
  const { addToast } = useToast();
  const [muted, setMuted] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getAlertPreferences()
      .then((data) => {
        if (!cancelled) setMuted(data.muted || []);
      })
      .catch((error) => {
        if (!cancelled) addToast(error.message || "Could not load your alert settings.", "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [addToast]);

  /*
   * Saved on the spot rather than behind a Save button. There is nothing to
   * review and nothing to cancel — and a page of toggles with an unsaved state
   * is how somebody ends up believing they muted something they did not.
   *
   * Applied optimistically and put back if the server refuses, so the switch
   * never ends up showing a setting the server does not hold.
   */
  const toggle = useCallback(
    async (type, receiving) => {
      const before = muted;
      const next = receiving ? muted.filter((t) => t !== type) : [...muted, type];

      setMuted(next);
      setBusy(type);
      try {
        const data = await setAlertPreferences(next);
        setMuted(data.muted || next);
      } catch (error) {
        setMuted(before);
        // Say what went wrong AND that the setting is untouched. The switch
        // has just sprung back on screen; without the second half that reads
        // as the page losing the change it had already made.
        addToast(
          `${error.message || "Could not reach the server"}. Nothing changed.`,
          "error"
        );
      } finally {
        setBusy(null);
      }
    },
    [muted, addToast]
  );

  return (
    <SettingsPage
      eyebrow="Account"
      title="Notifications"
      description="Which alerts reach you on the exceptions board. This affects your view only."
    >
      <p
        style={{
          display: "flex", alignItems: "flex-start", gap: 8, margin: "0 0 var(--s-4)",
          fontSize: "var(--fs-12)", color: "var(--text-3)", lineHeight: 1.5,
        }}
      >
        <Inbox size={14} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          Everything is on until you turn it off. A muted alert is still raised, still recorded and still
          counted in reports — it is only kept off your board. Filtering the board to a muted kind by name
          still shows it.
        </span>
      </p>

      {GROUPS.map((group) => (
        <FormSection key={group.title} title={group.title} description={group.description}>
          {group.items.map((item) => {
            const on = !muted.includes(item.type);
            return (
              <div
                key={item.type}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: "var(--s-4)",
                }}
              >
                <label htmlFor={`alert-${item.type}`} style={{ minWidth: 0, cursor: "pointer" }}>
                  <span
                    style={{
                      display: "flex", alignItems: "center", gap: 7,
                      fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text)",
                    }}
                  >
                    {item.label}
                    {!on && (
                      <span
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "1px 7px", borderRadius: "var(--r-pill)",
                          fontSize: "var(--fs-11)", fontWeight: 600,
                          background: "var(--surface-sunk)", color: "var(--text-3)",
                          border: "1px solid var(--line)",
                        }}
                      >
                        <BellOff size={10} />
                        Muted
                      </span>
                    )}
                  </span>
                  <span style={{ display: "block", marginTop: 2, fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
                    {item.when}
                  </span>
                </label>

                <Switch
                  id={`alert-${item.type}`}
                  label={item.label}
                  on={on}
                  busy={loading || busy === item.type}
                  onChange={(next) => toggle(item.type, next)}
                />
              </div>
            );
          })}
        </FormSection>
      ))}
    </SettingsPage>
  );
}
