import { useCallback, useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { Button, Field, inputStyle } from "../ui";
import { usePermissions } from "../../auth/permissions";
import { useToast } from "../shared/Toast";
import { correctOdometerReading, getOdometerPhoto, getTripOdometer } from "../../services/fleet/odometerService";

/**
 * The odometer on one trip, on its Assignment tab: what the driver read at the
 * start and the end, the distance between, the dashboard photos, and — for
 * whoever manages vehicles — a way to correct a wrong figure with a reason.
 * The driver's figure always stays on show; a correction sits beside it.
 *
 * Shows nothing for a trip with no readings, so trips from before readings
 * (or a company that does not take them) look as they always did.
 */

const MIN_REASON = 5;
const fmtKm = (n) => (n == null ? "—" : `${Number(n).toLocaleString("en-PH", { maximumFractionDigits: 1 })} km`);
const fmtWhen = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

function DashboardPhoto({ reading }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!reading.hasPhoto) return undefined;
    let live = true;
    getOdometerPhoto(reading.id).then((u) => live && setSrc(u)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [reading.id, reading.hasPhoto]);
  if (!reading.hasPhoto) return null;
  if (failed) return <span style={{ fontSize: "var(--fs-11)", color: "var(--text-3)" }}>Photo unavailable</span>;
  if (!src) return <span style={{ fontSize: "var(--fs-11)", color: "var(--text-3)" }}>Loading photo…</span>;
  return (
    <a href={src} target="_blank" rel="noreferrer" title="Open full size">
      <img src={src} alt={`Dashboard at the ${reading.kind}`} style={{ display: "block", maxWidth: 160, borderRadius: "var(--r-sm)", border: "1px solid var(--line)" }} />
    </a>
  );
}

function ReadingRow({ label, reading, canCorrect, onCorrect }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!reading) {
    return (
      <div className="tk-detail-row">
        <span className="tk-detail-label">{label}</span>
        <span className="tk-detail-value">Not recorded</span>
      </div>
    );
  }

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onCorrect(reading.id, value.trim(), reason.trim());
      setOpen(false);
      setValue("");
      setReason("");
    } catch (e) {
      setError(e.message || "Could not save the correction.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
      <div className="tk-detail-row" style={{ borderBottom: 0, padding: 0 }}>
        <span className="tk-detail-label">{label}</span>
        <span className="tk-detail-value">
          {reading.correctedValueKm != null ? (
            <>
              <strong>{fmtKm(reading.correctedValueKm)}</strong>
              <span style={{ color: "var(--text-3)" }}> (driver entered {fmtKm(reading.valueKm)})</span>
            </>
          ) : fmtKm(reading.valueKm)}
          <span style={{ color: "var(--text-3)" }}> · {fmtWhen(reading.capturedAt)}</span>
        </span>
      </div>
      {reading.correctionReason && (
        <div style={{ fontSize: "var(--fs-12)", color: "var(--text-2)" }}>
          Corrected {fmtWhen(reading.correctedAt)}: {reading.correctionReason}
        </div>
      )}
      <DashboardPhoto reading={reading} />
      {canCorrect && !open && (
        <div><Button size="sm" onClick={() => setOpen(true)}>Correct</Button></div>
      )}
      {canCorrect && open && (
        <div style={{ display: "grid", gap: 8, padding: "var(--s-3)", background: "var(--surface-sunk)", borderRadius: "var(--r-sm)" }}>
          <Field label={`Correct ${label.toLowerCase()} (km)`} required>
            <input style={inputStyle} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
          </Field>
          <Field label="Reason" required hint="For example: the dashboard photo shows a different figure. Kept on record and in the audit log.">
            <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
          </Field>
          {error && <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--fs-12)" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="primary" size="sm" loading={busy} disabled={!value.trim() || reason.trim().length < MIN_REASON} onClick={save}>
              Save correction
            </Button>
            <Button size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OdometerPanel({ tripId }) {
  const [data, setData] = useState(undefined);
  const { can } = usePermissions();
  const { addToast } = useToast();

  const load = useCallback(() => getTripOdometer(tripId).then(setData).catch(() => setData(null)), [tripId]);
  useEffect(() => { load(); }, [load]);

  if (!data || (!data.start && !data.end)) return null;

  const correct = async (id, value, reason) => {
    await correctOdometerReading(id, value, reason);
    addToast("Reading corrected.", "success");
    await load();
  };
  const canCorrect = can("vehicle.manage");

  return (
    <section className="ops-card" style={{ padding: "var(--s-4)" }} aria-label="Odometer">
      <div className="tk-stop-head" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Gauge size={14} /> Odometer
      </div>
      <div className="tk-detail-list">
        <ReadingRow label="Start reading" reading={data.start} canCorrect={canCorrect} onCorrect={correct} />
        <ReadingRow label="End reading" reading={data.end} canCorrect={canCorrect} onCorrect={correct} />
        <div className="tk-detail-row">
          <span className="tk-detail-label">Distance driven</span>
          <span className="tk-detail-value">{data.actualKm != null ? fmtKm(data.actualKm) : "Once both readings are in"}</span>
        </div>
      </div>
    </section>
  );
}
