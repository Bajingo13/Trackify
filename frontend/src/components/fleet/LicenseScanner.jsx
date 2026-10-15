import { useEffect, useRef, useState } from "react";
import { Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { scanDriverLicense } from "../../services/fleet/driverService";
import { licenceExpiry } from "../../services/fleet/licenceExpiry";
import { prepareLicenceFile } from "../../services/fleet/prepareLicenceFile";

/** 2027-01-15 → a day on the viewer's calendar, with no timezone to shift it. */
const day = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
};

const TONES = {
  info: { bg: "var(--info-soft)", border: "var(--info-line)", text: "var(--info)" },
  warn: { bg: "var(--warn-soft)", border: "var(--warn-line)", text: "var(--warn)" },
  danger: { bg: "var(--danger-soft)", border: "var(--danger-line)", text: "var(--danger)" },
};

/**
 * What the scan found, in plain words: a list of { tone, text } the box shows.
 * Exported for tests. Order is most important first.
 */
export function describeScan(result) {
  if (!result) return [];
  const out = [];

  if (result.status !== "read") {
    out.push({
      tone: "warn",
      text: result.message || "That photo could not be read. Upload a clearer image and try again.",
    });
    return out;
  }

  const expiry = result.fields?.licenseExpiry;
  if (expiry) {
    const e = licenceExpiry(expiry);
    if (e.state === "expired") {
      out.push({ tone: "danger", text: `This licence expired on ${day(expiry)} (${e.text.replace(/^Expired /, "")}). The driver cannot be assigned trips until it is renewed.` });
    } else if (e.state === "expiring") {
      out.push({ tone: "warn", text: `This licence expires on ${day(expiry)} (${e.text.toLowerCase().replace("expires ", "")}).` });
    }
  }
  if (result.duplicateOf) {
    out.push({ tone: "danger", text: `This licence number already belongs to ${result.duplicateOf.name}.` });
  }
  out.push({
    tone: "info",
    text: result.found > 1
      ? `Filled in ${result.found} detail${result.found === 1 ? "" : "s"} from the licence. Check each against the card before saving.`
      : "Only part of the licence could be read. Fill in the rest by hand.",
  });
  return out;
}

/**
 * Upload a photo or scan of a driver's licence and have its details read.
 *
 * Deliberately knows nothing about the form: it reads the licence and hands the
 * parent the file and the result (`onScanned(file, result)`), and the parent
 * decides what to put where. The same box therefore serves the Add Driver form,
 * the Edit form and the driver's detail page.
 *
 * The result is handed to the parent for review. Registration requires a
 * readable result; OCR values may still be corrected by the Admin.
 */
export default function LicenseScanner({ driverId, onScanned, onCleared, title = "Scan driver's licence", disabled = false }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState(null);
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const latest = useRef(0);

  useEffect(() => {
    if (!file || !String(file.type).startsWith("image/")) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function choose(picked) {
    if (!picked) return;
    // answers can arrive out of order if somebody picks twice; only the last counts
    const mine = (latest.current += 1);
    setReading(true);
    setResult(null);
    let ready;
    try {
      // a photo is brought to a sensible size; a PDF from a scanner becomes an image of its first page
      ready = await prepareLicenceFile(picked);
    } catch (ex) {
      if (mine !== latest.current) return;
      const outcome = { status: "unsupported", message: ex.message };
      setFile(null);
      setResult(outcome);
      setReading(false);
      onScanned?.(null, outcome);
      return;
    }
    setFile(ready);
    let outcome;
    try {
      outcome = await scanDriverLicense(ready, driverId);
    } catch (ex) {
      outcome = { status: "failed", message: ex.message || "The licence could not be read." };
    }
    if (mine !== latest.current) return;
    setResult(outcome);
    setReading(false);
    onScanned?.(ready, outcome);
  }

  function clear() {
    latest.current += 1;
    setFile(null);
    setResult(null);
    setReading(false);
    onCleared?.();
  }

  const lines = describeScan(result);

  return (
    <div
      style={{
        border: `1px dashed ${over ? "var(--info)" : "var(--trackify-border)"}`,
        background: over ? "var(--info-soft)" : "var(--surface-2, transparent)",
        borderRadius: 10, padding: 14, marginBottom: 16,
      }}
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) choose(e.dataTransfer.files?.[0]); }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        {preview ? (
          <img src={preview} alt="The licence you chose" style={{ width: 120, height: 76, objectFit: "cover", borderRadius: 6, border: "1px solid var(--trackify-border)" }} />
        ) : (
          <span style={{ width: 44, height: 44, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--info-soft)", color: "var(--info)" }}>
            <Upload size={20} />
          </span>
        )}

        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 12, color: "var(--trackify-text-secondary)", marginTop: 2 }}>
            {file
              ? file.name
              : "Upload a clear photo of the licence — or drop it here — and the details below are filled in for you."}
          </div>
        </div>

        <span style={{ display: "flex", gap: 6 }}>
          <button type="button" className="ops-btn ops-btn-secondary" style={{ padding: "6px 12px", fontSize: 12 }}
            disabled={disabled || reading} onClick={() => input.current?.click()}>
            {reading ? "Reading…" : file ? "Replace photo" : "Choose photo"}
          </button>
          {file && !reading && (
            <button type="button" className="ops-btn ops-btn-ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={clear}>
              Remove
            </button>
          )}
        </span>
        <input ref={input} type="file" accept="image/*,application/pdf" hidden aria-label="Licence photo"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; choose(f); }} />
      </div>

      {reading && (
        <div role="status" style={{ marginTop: 10, fontSize: 12, color: "var(--trackify-text-secondary)" }}>
          Reading the licence… this takes a few seconds.
        </div>
      )}

      {lines.map((line, i) => {
        const t = TONES[line.tone];
        const Icon = line.tone === "info" ? CheckCircle2 : AlertTriangle;
        return (
          <div key={i} role={line.tone === "info" ? "status" : "alert"}
            style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, padding: "8px 10px", borderRadius: 8, fontSize: 12, lineHeight: 1.45,
              background: t.bg, border: `1px solid ${t.border}`, color: t.text }}>
            <Icon size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{line.text}</span>
          </div>
        );
      })}
    </div>
  );
}
