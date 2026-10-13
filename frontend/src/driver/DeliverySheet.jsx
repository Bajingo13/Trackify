import { useEffect, useState } from "react";
import PhotoPick from "./PhotoPick";

/**
 * Proof of delivery.
 *
 * This used to be a window.prompt asking for a name. A POD is the document
 * that settles a dispute and releases billing, so it captures who signed for
 * the load, a photo, and where the driver was standing when they confirmed —
 * the position is read once, on open, so it reflects the drop-off and not
 * wherever the phone happens to be when the form is finally submitted.
 *
 * The photo comes first and is required: it is the evidence, and the name is
 * only checked against it. Confirm stays shut until there is both a photo and a
 * name, and says which is missing rather than leaving a dead button.
 *
 * It opens over the screen as a sheet rather than inside the page, so it looks
 * the same whether it was opened by hand or because the truck reached the pin.
 */
export default function DeliverySheet({ tripNo, place, arrived = false, busy, onCancel, onConfirm }) {
  const [receivedBy, setReceivedBy] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [pos, setPos] = useState(null);
  const [fixState, setFixState] = useState("locating");

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

  // A thumbnail, so the driver can see the shot is the right one before sending.
  useEffect(() => {
    if (!photo || !String(photo.type).startsWith("image/") || typeof URL.createObjectURL !== "function") {
      setPreview(null);
      return undefined;
    }
    const made = URL.createObjectURL(photo);
    setPreview(made);
    return () => URL.revokeObjectURL(made);
  }, [photo]);

  const who = receivedBy.trim();
  const ready = Boolean(photo) && Boolean(who);
  const missing = !photo ? "Take a photo of the delivery first." : !who ? "Enter who received it." : "";

  function submit(e) {
    e.preventDefault();
    if (!ready) return;

    const form = new FormData();
    form.set("receivedBy", who);
    if (note.trim()) form.set("note", note.trim());
    if (pos) { form.set("lat", String(pos.lat)); form.set("lng", String(pos.lng)); }
    form.set("photo", photo);
    onConfirm(form);
  }

  const fix = {
    locating: "Getting your location…",
    ok: pos ? `Location captured · ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}` : "",
    unavailable: "Location unavailable — the delivery still records without it.",
  }[fixState];

  return (
    <div className="dr-pod">
      <form className="dr-pod-card" onSubmit={submit} aria-label="Confirm delivery">
        <span className="dr-sheet-grab" aria-hidden="true" />
        <div>
          <div style={{ fontWeight: 800, fontSize: 17 }}>
            {arrived ? "You’ve arrived" : "Confirm delivery"}
          </div>
          <div style={{ fontSize: 13, color: "var(--dr-text-2)" }}>
            {tripNo}{arrived && place ? ` · ${place}` : ""}
          </div>
        </div>

        <div>
          <span className="dr-label">Photo of the delivery <em className="dr-req">*</em></span>
          <div className="dr-pod-photo" data-has={photo ? "yes" : "no"}>
            {photo && (
              <div className="dr-pod-shot">
                {preview ? <img src={preview} alt="Delivery photo to send" /> : <span className="dr-receipt-pdf">FILE</span>}
                <span className="dr-receipt-name">{photo.name || "Photo"}</span>
              </div>
            )}
            {/* Either way in. A driver who photographed the waybill before opening
                the app could not reach it while the camera was forced. */}
            <div className="dr-receipt-pick">
              <PhotoPick
                onFile={setPhoto}
                facing="environment"
                takeLabel={photo ? "Retake" : "Take photo"}
                pickLabel="From gallery"
              />
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--dr-text-2)", marginTop: 6 }}>
            The signed waybill, or the goods at the door.
          </div>
        </div>

        <div>
          <label className="dr-label" htmlFor="pod-name">Who received it? <em className="dr-req">*</em></label>
          <input
            id="pod-name"
            className="dr-field"
            value={receivedBy}
            onChange={(e) => setReceivedBy(e.target.value)}
            placeholder="Full name of the person signing"
            autoComplete="off"
          />
        </div>

        <div>
          <label className="dr-label" htmlFor="pod-note">Note <span className="dr-opt">(optional)</span></label>
          <input
            id="pod-note"
            className="dr-field"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. 2 crates short, noted on the waybill"
          />
        </div>

        <div style={{ fontSize: 12, color: "var(--dr-text-2)" }}>{fix}</div>

        {!ready && <div className="dr-pod-need" role="status">{missing}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="dr-btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="dr-btn ok" disabled={busy || !ready}>
            {busy ? "Confirming…" : "Confirm delivery"}
          </button>
        </div>
      </form>
    </div>
  );
}
