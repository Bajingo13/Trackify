import { useEffect, useRef, useState } from "react";
import PhotoPick from "./PhotoPick";

/**
 * Proof of delivery.
 *
 * This used to be a window.prompt asking for a name. A POD is the document
 * that settles a dispute and releases billing, so it captures who signed for
 * the load, a photo, and where the driver was standing when they confirmed —
 * the position is read once, on open, so it reflects the drop-off and not
 * wherever the phone happens to be when the form is finally submitted.
 */
export default function DeliverySheet({ tripNo, busy, onCancel, onConfirm }) {
  const [receivedBy, setReceivedBy] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);
  const [pos, setPos] = useState(null);
  const [fixState, setFixState] = useState("locating");
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) { setFixState("unavailable"); return; }
    let dead = false;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (dead) return;
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setFixState("ok");
      },
      () => { if (!dead) setFixState("unavailable"); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
    return () => { dead = true; };
  }, []);

  function submit(e) {
    e.preventDefault();
    const who = receivedBy.trim();
    if (!who) { setErr("Enter who received the delivery."); return; }
    setErr("");

    const form = new FormData();
    form.set("receivedBy", who);
    if (note.trim()) form.set("note", note.trim());
    if (pos) { form.set("lat", String(pos.lat)); form.set("lng", String(pos.lng)); }
    if (photo) form.set("photo", photo);
    onConfirm(form);
  }

  const fix = {
    locating: "Getting your location…",
    ok: pos ? `Location captured · ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}` : "",
    unavailable: "Location unavailable — the delivery still records without it.",
  }[fixState];

  return (
    <form className="dr-card" onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 17 }}>Confirm delivery</div>
        <div style={{ fontSize: 13, color: "var(--dr-text-2)" }}>{tripNo}</div>
      </div>

      <div>
        <label className="dr-label" htmlFor="pod-name">Who received it? *</label>
        <input
          id="pod-name"
          className="dr-input"
          value={receivedBy}
          onChange={(e) => setReceivedBy(e.target.value)}
          placeholder="Full name of the person signing"
          autoFocus
        />
      </div>

      <div>
        <label className="dr-label" htmlFor="pod-note">Note (optional)</label>
        <input
          id="pod-note"
          className="dr-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. 2 crates short, noted on the waybill"
        />
      </div>

      <div>
        <span className="dr-label">Photo of the delivery</span>
        {/* Either way in. A driver who photographed the waybill before opening
            the app could not reach it while the camera was forced. */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <PhotoPick
            onFile={setPhoto}
            facing="environment"
            takeLabel={photo ? "Retake" : "Take photo"}
            pickLabel="From gallery"
          />
        </div>
        <div style={{ fontSize: 12, color: "var(--dr-text-2)", marginTop: 4 }}>
          {photo ? photo.name : "The signed waybill, or the goods at the door."}
        </div>
      </div>

      <div style={{ fontSize: 12, color: "var(--dr-text-2)" }}>{fix}</div>

      {err && <div className="dr-err">{err}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="dr-btn ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="dr-btn ok" disabled={busy}>
          {busy ? "Confirming…" : "Confirm delivery"}
        </button>
      </div>
    </form>
  );
}
