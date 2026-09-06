import { useEffect, useState } from "react";
import { Check, X, Receipt, Loader2 } from "lucide-react";
import { getDataUrl } from "../../services/apiClient";
import { expenseApi } from "../../services/finance/financeService";
import StateBadge from "../../components/shared/StateBadge";

const peso = (n) => `₱${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

/** Receipts sit behind an authenticated route, so they load as data URLs. */
function ReceiptImage({ attachmentId }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let dead = false;
    getDataUrl(expenseApi.receiptUrl(attachmentId))
      .then((u) => !dead && setUrl(u))
      .catch((e) => !dead && setErr(e.message));
    return () => { dead = true; };
  }, [attachmentId]);

  if (err) return <div style={{ fontSize: "var(--fs-12)", color: "var(--text-3)" }}>{err}</div>;
  if (!url) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
        <Loader2 size={13} className="tk-spin" /> Loading receipt…
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" title="Open full size">
      <img
        src={url}
        alt="Receipt"
        style={{
          maxWidth: "100%", maxHeight: 260, borderRadius: "var(--r-sm)",
          border: "1px solid var(--line)", display: "block", background: "var(--surface-sunk)",
        }}
      />
    </a>
  );
}

/**
 * Review queue for expenses drivers filed from the road.
 *
 * Approving is what moves a claim into the books — until then it cannot reach
 * a voucher. A rejection needs a reason, which the driver sees in their app.
 */
export default function DriverClaimReview({ onReviewed }) {
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});
  const [err, setErr] = useState("");

  const load = () =>
    expenseApi
      .list({ status: "submitted" })
      .then(setRows)
      .catch((e) => { setErr(e.message); setRows([]); });

  useEffect(() => { load(); }, []);

  async function act(row, kind) {
    const note = (notes[row.id] || "").trim();
    if (kind === "reject" && !note) {
      setErr("Give a reason so the driver knows what to fix.");
      return;
    }
    setErr("");
    setBusyId(row.id);
    try {
      await (kind === "approve" ? expenseApi.approve(row.id, note) : expenseApi.reject(row.id, note));
      setNotes((p) => ({ ...p, [row.id]: "" }));
      await load();
      onReviewed?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (rows == null) {
    return <div className="ops-card" style={{ padding: 20, color: "var(--text-3)" }}>Loading driver claims…</div>;
  }
  if (rows.length === 0) return null;

  return (
    <div className="ops-card" style={{ marginBottom: "var(--s-4)" }}>
      <div className="ops-card-header" style={{ justifyContent: "space-between" }}>
        <h3 className="ops-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Receipt size={15} style={{ color: "var(--text-3)" }} />
          Driver claims awaiting review
        </h3>
        <StateBadge status={`${rows.length} pending`} tone="warn" />
      </div>

      {err && (
        <div style={{ margin: "0 16px 12px", fontSize: "var(--fs-12)", color: "var(--danger)" }}>{err}</div>
      )}

      <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: "var(--s-3)" }}>
        {rows.map((r) => (
          <div key={r.id} className="tk-claim">
            <div className="tk-claim-body">
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: "var(--fs-16, 1rem)", fontVariantNumeric: "tabular-nums" }}>
                  {peso(r.amount)}
                </span>
                <StateBadge status={r.category} tone="accent" />
                <span style={{ fontSize: "var(--fs-12)", color: "var(--text-2)" }}>
                  {r.tripNo || "—"} · {r.submittedByDriver || "driver"}
                </span>
              </div>

              <div style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", marginTop: 2 }}>
                {r.expenseDate ? new Date(r.expenseDate).toLocaleDateString() : "—"}
                {r.receiptNo ? ` · OR ${r.receiptNo}` : " · no OR number"}
              </div>

              {r.description && (
                <div style={{ fontSize: "var(--fs-13)", color: "var(--text)", marginTop: 4 }}>{r.description}</div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <input
                  className="tk-claim-note"
                  placeholder="Note (required to reject)"
                  value={notes[r.id] || ""}
                  onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))}
                />
                <button
                  className="ops-btn ops-btn-secondary"
                  disabled={busyId === r.id}
                  onClick={() => act(r, "reject")}
                >
                  <X size={13} /> Reject
                </button>
                <button
                  className="ops-btn ops-btn-primary"
                  disabled={busyId === r.id}
                  onClick={() => act(r, "approve")}
                >
                  <Check size={13} /> Approve
                </button>
              </div>
            </div>

            <div className="tk-claim-receipt">
              {r.attachments?.length ? (
                <ReceiptImage attachmentId={r.attachments[0]} />
              ) : (
                <div style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", textAlign: "center", padding: "var(--s-4)" }}>
                  No receipt photo attached
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
