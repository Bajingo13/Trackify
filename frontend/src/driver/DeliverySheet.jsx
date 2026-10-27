import { useEffect, useRef, useState } from "react";
import PhotoPick from "./PhotoPick";
import SignaturePad from "./SignaturePad";

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
/* Why a receiver did not sign, in the driver's words (the server stores the codes). */
export const UNSIGNED_REASONS = [
  { value: "refused", label: "Refused to sign" },
  { value: "not_present", label: "Receiver not present" },
  { value: "unable", label: "Unable to sign" },
];

export default function DeliverySheet({ tripNo, place, arrived = false, busy, signatureRequired = false, onCancel, onConfirm }) {
  // The receiver's signature: drawn on the pad, or the reason there is none.
  // Offered on every delivery; needed (one or the other) when the company says so.
  const pad = useRef(null);
  const [signed, setSigned] = useState(false);
  const [noSignature, setNoSignature] = useState(false);
  const [unsignedReason, setUnsignedReason] = useState("");
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
  const signatureDone = signed || (noSignature && Boolean(unsignedReason));
  const ready = Boolean(photo) && Boolean(who) && (!signatureRequired || signatureDone);
  const missing = !photo ? "Take a photo of the delivery first."
    : !who ? "Enter who received it."
      : signatureRequired && !signatureDone
        ? noSignature ? "Say why there is no signature." : "Have the receiver sign, or tap “Receiver did not sign”."
        : "";

  // Turning the drawing into a PNG takes a moment, before the screen is busy;
  // a second tap in that gap must not file the delivery twice.
  const sending = useRef(false);
  const send = (form) => {
    sending.current = true;
    void Promise.resolve(onConfirm(form)).finally(() => { sending.current = false; });
  };

  function submit(e) {
    e.preventDefault();
    if (!ready || busy || sending.current) return;

    const form = new FormData();
    form.set("receivedBy", who);
    if (note.trim()) form.set("note", note.trim());
    if (pos) { form.set("lat", String(pos.lat)); form.set("lng", String(pos.lng)); }
    form.set("photo", photo);
    if (noSignature && unsignedReason) {
      form.set("unsignedReason", unsignedReason);
      send(form);
      return;
    }
    if (!signed || !pad.current) { send(form); return; }
    // the drawing, as a PNG; the outbox keeps it like the photo when there is no signal
    sending.current = true;
    void pad.current.toBlob().then((blob) => {
      if (blob) form.set("signature", blob, "signature.png");
      send(form);
    });
  }

  const skipSignature = (on) => {
    setNoSignature(on);
    if (on) { pad.current?.clear(); setSigned(false); } else setUnsignedReason("");
  };

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
          <span className="dr-label">
            Receiver&rsquo;s signature {signatureRequired ? <em className="dr-req">*</em> : <span className="dr-opt">(optional)</span>}
          </span>
          {!noSignature ? (
            <>
              <div className="dr-sigpad-box">
                <SignaturePad ref={pad} onChange={setSigned} label="Receiver's signature" />
                {!signed && <span className="dr-sigpad-hint" aria-hidden="true">Sign here</span>}
              </div>
              <div className="dr-sigpad-actions">
                <button type="button" className="dr-linkbtn" disabled={!signed || busy} onClick={() => { pad.current?.clear(); setSigned(false); }}>
                  Clear
                </button>
                <button type="button" className="dr-linkbtn" disabled={busy} onClick={() => skipSignature(true)}>
                  Receiver did not sign
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="dr-chips" role="radiogroup" aria-label="Why there is no signature">
                {UNSIGNED_REASONS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    role="radio"
                    aria-checked={unsignedReason === r.value}
                    className={`dr-chip ${unsignedReason === r.value ? "on" : ""}`}
                    onClick={() => setUnsignedReason(r.value)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <button type="button" className="dr-linkbtn" style={{ marginTop: 6 }} disabled={busy} onClick={() => skipSignature(false)}>
                Sign instead
              </button>
            </>
          )}
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
