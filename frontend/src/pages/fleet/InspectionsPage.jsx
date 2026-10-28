import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, ClipboardCheck } from "lucide-react";
import AppShell from "../../components/layout/AppShell";
import { Button, Drawer, Field, Segmented, inputStyle } from "../../components/ui";
import { usePermissions } from "../../auth/permissions";
import { useToast } from "../../components/shared/Toast";
import StateBadge from "../../components/shared/StateBadge";
import {
  approveDeparture, getInspection, getInspectionPhoto, inspectionStatus, listInspections, reviewInspection,
} from "../../services/fleet/inspectionService";
import "../../styles/operations.css";

/**
 * Fleet → Inspections.
 *
 * Every pre-trip inspection a driver filed, the ones waiting for Fleet first:
 * a failed critical item (brakes, tyres, lights) holds the trip until departure
 * is approved here, with a reason that is kept and audited; any other problem
 * is reviewed and the trip may already be on its way. Approving or reviewing
 * here also settles the matching exception in the Exceptions panel.
 */

const FILTERS = [
  { value: "pending", label: "Waiting for Fleet" },
  { value: "failed", label: "With problems" },
  { value: "all", label: "All" },
];
const MIN_REASON = 5;

const fmt = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const RESPONSE = { ok: { label: "OK", tone: "ok" }, problem: { label: "Problem", tone: "danger" }, na: { label: "N/A", tone: "muted" } };

/** One defect photo. It needs the signed-in session, so it is fetched, not linked. */
function DefectPhoto({ inspectionId, photo }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    getInspectionPhoto(inspectionId, photo.id)
      .then((url) => { if (live) setSrc(url); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [inspectionId, photo.id]);
  const box = { width: 96, height: 96, borderRadius: "var(--r-sm)", border: "1px solid var(--line)", background: "var(--surface-sunk)", overflow: "hidden", display: "grid", placeItems: "center", fontSize: "var(--fs-11)", color: "var(--text-3)" };
  if (failed) return <div style={box}>Photo unavailable</div>;
  if (!src) return <div style={box} aria-label="Loading photo" />;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" style={box} aria-label={`Open photo ${photo.id}`}>
      <img src={src} alt={`Defect photo ${photo.id}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </a>
  );
}

function InspectionDetail({ id, onChanged }) {
  const [row, setRow] = useState(undefined);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { can } = usePermissions();
  const { addToast } = useToast();

  const load = useCallback(() => getInspection(id).then(setRow).catch((e) => { setRow(null); setError(e.message); }), [id]);
  useEffect(() => { setRow(undefined); setText(""); setError(""); load(); }, [load]);

  if (row === undefined) return <p style={{ color: "var(--text-3)" }}>Loading the inspection…</p>;
  if (!row) return <p style={{ color: "var(--danger)" }}>{error || "Inspection not found."}</p>;

  const status = inspectionStatus(row);
  const needsApproval = row.result === "fail_critical" && !row.approvedAt;
  const needsReview = row.result === "fail_noncritical" && row.reviewStatus === "pending";

  async function act(fn, done) {
    setError("");
    setBusy(true);
    try {
      await fn();
      addToast(done, "success");
      setText("");
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message || "Could not do that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <StateBadge status={status.label} tone={status.tone} />
        <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
          {row.plateNo || "Vehicle"} · {row.ticketNo} · {row.driverName}
        </span>
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: 0, fontSize: "var(--fs-13)" }}>
        <dt style={{ color: "var(--text-3)" }}>Done</dt><dd style={{ margin: 0 }}>{fmt(row.capturedAt)}</dd>
        <dt style={{ color: "var(--text-3)" }}>Received</dt><dd style={{ margin: 0 }}>{fmt(row.submittedAt)}</dd>
        {row.approvedAt && <><dt style={{ color: "var(--text-3)" }}>Approved</dt><dd style={{ margin: 0 }}>{fmt(row.approvedAt)} — {row.approvalReason}</dd></>}
        {row.reviewedAt && !row.approvedAt && <><dt style={{ color: "var(--text-3)" }}>Reviewed</dt><dd style={{ margin: 0 }}>{fmt(row.reviewedAt)}{row.reviewNote ? ` — ${row.reviewNote}` : ""}</dd></>}
      </dl>

      <section aria-label="Checklist" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {row.items.map((item) => {
          const r = RESPONSE[item.response] || RESPONSE.na;
          const photos = row.photos.filter((p) => p.itemKey === item.key);
          return (
            <div key={item.key} style={{ padding: "10px 12px", border: `1px solid ${item.response === "problem" ? "var(--danger-line)" : "var(--line)"}`, borderRadius: "var(--r-sm)", background: "var(--surface)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong style={{ fontSize: "var(--fs-13)", color: "var(--text)" }}>{item.label}</strong>
                {item.critical && <span style={{ fontSize: "var(--fs-11)", color: "var(--text-3)" }}>Critical</span>}
                <span style={{ marginLeft: "auto" }}><StateBadge status={r.label} tone={r.tone} /></span>
              </div>
              {item.note && <p style={{ margin: "6px 0 0", fontSize: "var(--fs-13)", color: "var(--text-2)" }}>{item.note}</p>}
              {photos.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {photos.map((p) => <DefectPhoto key={p.id} inspectionId={row.id} photo={p} />)}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {needsApproval && can("inspection.review") && (
        <section aria-label="Approve departure" style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: "var(--s-3)", borderTop: "1px solid var(--line)" }}>
          <Field label="Why can this vehicle go?" required hint="For example: the defect was repaired and tested, or the vehicle was replaced. Kept on record and in the audit log.">
            <textarea
              style={{ ...inputStyle, minHeight: 72, resize: "vertical" }}
              maxLength={1000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Button
            variant="primary"
            loading={busy}
            disabled={text.trim().length < MIN_REASON}
            onClick={() => act(() => approveDeparture(row.id, text.trim()), "Departure approved. The driver can start the trip.")}
          >
            Approve departure
          </Button>
        </section>
      )}

      {needsReview && can("inspection.review") && (
        <section aria-label="Mark reviewed" style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: "var(--s-3)", borderTop: "1px solid var(--line)" }}>
          <Field label="Note (optional)" hint="What was done about it.">
            <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
          </Field>
          <Button loading={busy} onClick={() => act(() => reviewInspection(row.id, text.trim()), "Marked as reviewed.")}>Mark reviewed</Button>
        </section>
      )}

      {error && <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--fs-13)" }}>{error}</p>}
    </div>
  );
}

export default function InspectionsPage() {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState("pending");
  const [rows, setRows] = useState(null);
  const openId = Number(params.get("open")) || null;
  const { addToast } = useToast();

  const load = useCallback(() => listInspections(filter)
    .then(setRows)
    .catch((e) => { setRows([]); addToast(e.message || "Could not load inspections.", "error"); }), [filter, addToast]);
  useEffect(() => { load(); }, [load]);

  const open = (id) => setParams(id ? { open: String(id) } : {});

  return (
    <AppShell>
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left">
            <h1 className="ops-title">Pre-trip Inspections</h1>
            <p className="ops-subtitle">What drivers found before setting off. A failed brake, tyre or light check holds the trip until you approve departure.</p>
          </div>
        </div>

        <div className="ops-card">
          <div className="ops-card-header" style={{ justifyContent: "space-between" }}>
            <Segmented options={FILTERS} value={filter} onChange={setFilter} />
          </div>
          <div style={{ padding: "12px 20px" }}>
            {rows === null ? (
              <p style={{ color: "var(--text-3)" }}>Loading…</p>
            ) : rows.length === 0 ? (
              <div className="ops-empty" style={{ padding: 40 }}>
                <div style={{ width: 56, height: 56, borderRadius: "var(--r-md)", background: "var(--surface-sunk)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12, color: "var(--text-3)" }}>
                  <CheckCircle2 size={28} />
                </div>
                <div className="ops-empty-title">{filter === "pending" ? "Nothing waiting" : "No inspections"}</div>
                <div className="ops-empty-desc">{filter === "pending" ? "No inspection needs Fleet right now." : "Drivers have not filed any yet."}</div>
              </div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {rows.map((row) => {
                  const status = inspectionStatus(row);
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => open(row.id)}
                        style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", cursor: "pointer", font: "inherit", color: "inherit" }}
                      >
                        <span style={{ width: 30, height: 30, borderRadius: "var(--r-xs)", background: "var(--surface-sunk)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--text-3)" }}>
                          <ClipboardCheck size={14} />
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text)" }}>
                            {row.plateNo || "Vehicle"} · {row.ticketNo}
                          </span>
                          <span style={{ display: "block", fontSize: "var(--fs-12)", color: "var(--text-2)" }}>
                            {row.driverName} · {fmt(row.submittedAt)}
                          </span>
                        </span>
                        <StateBadge status={status.label} tone={status.tone} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <Drawer open={Boolean(openId)} onClose={() => open(null)} title="Pre-trip inspection" width={520}>
          {openId && <InspectionDetail id={openId} onChanged={load} />}
        </Drawer>
      </div>
    </AppShell>
  );
}

export { InspectionDetail };
