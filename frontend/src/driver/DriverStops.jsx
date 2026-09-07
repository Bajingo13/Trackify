import { useState } from "react";
import { driverArriveAtStop } from "./driverApi";

const fmt = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

/**
 * The stops on this run, in order, with a button to mark the one you have
 * reached.
 *
 * The position is read at the moment the driver taps, not when the screen
 * loaded — a stop record is only worth something if it says where the truck
 * actually was. A refused fix does not block the record; the arrival still
 * counts, it just has no coordinates against it.
 */
export default function DriverStops({ tripId, stops, canRecord, onRecorded }) {
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState("");

  if (!stops?.length) return null;

  const done = stops.filter((s) => s.arrivedAt).length;

  const readPosition = () =>
    new Promise((resolve) => {
      if (!("geolocation" in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
      );
    });

  async function arrive(stop) {
    setErr("");
    setBusyId(stop.id);
    try {
      const pos = await readPosition();
      await driverArriveAtStop(tripId, stop.id, pos || {});
      onRecorded?.();
    } catch (e) {
      setErr(e.message || "Could not record that stop.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="dr-card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontWeight: 800 }}>Stops</span>
        <span style={{ fontSize: 13, color: "var(--dr-text-2)" }}>
          {done} of {stops.length} reached
        </span>
      </div>

      <ol className="dr-stops">
        {stops.map((s, i) => {
          const at = fmt(s.arrivedAt);
          return (
            <li key={s.id ?? i} className="dr-stop" data-done={s.arrivedAt ? "yes" : "no"}>
              <span className="dr-stop-dot" aria-hidden="true" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="dr-stop-label">{i + 1}. {s.label}</div>
                <div className="dr-stop-meta">
                  {at ? `Reached ${at}` : "Not yet reached"}
                </div>
              </div>
              {canRecord && !s.arrivedAt && (
                <button
                  type="button"
                  className="dr-stop-btn"
                  disabled={busyId === s.id}
                  onClick={() => arrive(s)}
                >
                  {busyId === s.id ? "Saving…" : "Arrived"}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {err && <div className="dr-err" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  );
}
