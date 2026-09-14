import { useRef, useState } from "react";
import { X, Upload, Trash2 } from "lucide-react";
import VehiclePhoto from "./VehiclePhoto";
import { photoFor } from "./vehiclePhotos";
import {
  useTypePhotos,
  uploadTypePhoto,
  removeTypePhoto,
} from "../../services/fleet/vehicleTypePhotos";
import { VEHICLE_TYPES } from "../../services/fleet/vehicleService";

/**
 * What each kind of vehicle looks like, for this company.
 *
 * The app ships four photographs across ten body shapes, so several types are
 * shown something close rather than something right — a Closed Van gets a box
 * truck. Rather than guess harder, an operator points each type at their own
 * photograph and it is used everywhere that type is drawn, including the
 * driver's phone.
 *
 * Every type is listed, not only the ones in use, so a photo can be set before
 * the first vehicle of that type is added rather than after somebody notices
 * the wrong picture.
 */
export default function VehicleTypePhotos({ types = [], onClose }) {
  const { photos } = useTypePhotos();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState("");

  // Any type actually on a vehicle, even one the dropdown has never heard of,
  // plus every type we offer. A company that invented "Wing Van 10W" should
  // be able to give it a picture.
  const all = [...new Set([...VEHICLE_TYPES, ...types.filter(Boolean)])].sort();

  async function set(type, file) {
    setBusy(type);
    setErr("");
    try {
      await uploadTypePhoto(type, file);
    } catch (e) {
      setErr(`${type}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function clear(type) {
    setBusy(type);
    setErr("");
    try {
      await removeTypePhoto(type);
    } catch (e) {
      setErr(`${type}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ops-modal-overlay" onClick={onClose}>
      <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="ops-modal-header">
          <h3 className="ops-modal-title">Vehicle photos</h3>
          <button className="ops-btn ops-btn-ghost" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="ops-modal-body">
          <p style={{ margin: "0 0 4px", fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
            One photograph per kind of vehicle. It is used everywhere that type
            appears — fleet, dispatch, tracking, and the driver app.
          </p>
          <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.5 }}>
            Use a <strong>PNG with a transparent background</strong>, shot side-on
            with the front facing left. A photo with its own white background will
            be shown on a white plate, because a white truck on a white square
            cannot be cut out afterwards.
          </p>

          {err && (
            <div
              style={{
                margin: "0 0 12px", padding: "8px 12px", borderRadius: 8,
                background: "var(--danger-soft, #fbeaea)", color: "var(--danger, #c23b3b)",
                fontSize: 13,
              }}
            >
              {err}
            </div>
          )}

          <div style={{ display: "grid", gap: 8 }}>
            {all.map((type) => (
              <TypeRow
                key={type}
                type={type}
                hasOwn={photos.has(type) && photos.get(type) != null}
                busy={busy === type}
                onPick={(file) => set(type, file)}
                onClear={() => clear(type)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Which of the three sources this type is currently resolving to. */
function sourceLabel(hasOwn, type) {
  if (hasOwn) return { text: "Your photo", tone: "var(--ok, #158a4a)" };
  if (photoFor(type)) return { text: "Stock photo", tone: "var(--text-3)" };
  return { text: "Drawing", tone: "var(--text-3)" };
}

function TypeRow({ type, hasOwn, busy, onPick, onClear }) {
  const file = useRef(null);
  const src = sourceLabel(hasOwn, type);

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "10px 14px",
        border: "1px solid var(--line)", borderRadius: 10,
        background: "var(--surface-2)",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <div style={{ width: 92, flexShrink: 0, display: "grid", placeItems: "center" }}>
        <VehiclePhoto type={type} height={40} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{type}</div>
        <div style={{ fontSize: 12, color: src.tone }}>{src.text}</div>
      </div>

      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button
          className="ops-btn ops-btn-secondary"
          disabled={busy}
          onClick={() => file.current?.click()}
          style={{ padding: "6px 10px" }}
        >
          <Upload size={13} /> {hasOwn ? "Replace" : "Upload"}
        </button>
        {hasOwn && (
          <button
            className="ops-btn ops-btn-ghost"
            disabled={busy}
            onClick={onClear}
            title="Use the stock photo again"
            style={{ padding: "6px 10px", color: "var(--danger, #EF4444)" }}
          >
            <Trash2 size={13} />
          </button>
        )}
        <input
          ref={file}
          type="file"
          accept="image/png,image/webp,image/jpeg"
          hidden
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            e.target.value = "";
            if (chosen) onPick(chosen);
          }}
        />
      </div>
    </div>
  );
}
