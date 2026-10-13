import { useCallback, useEffect, useState } from "react";
import { driverExpenses } from "./driverApi";
import DriverClaimForm from "./DriverClaimForm";

const peso = (n) => `₱${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

const STATUS_TEXT = {
  submitted: "Waiting for review",
  recorded: "Approved",
  on_voucher: "Approved",
  reimbursed: "Reimbursed",
  rejected: "Rejected",
};

/**
 * What the driver spent on this trip.
 *
 * The list is here; filing a new one opens the same claim form the Claims tab
 * uses, already pointed at this run, so there is one way to file and one set of
 * checks. Nothing posts to the books: every claim goes in as "waiting for
 * review" and only finance can approve it.
 */
export default function DriverExpenses({ tripId, ticketNo, canAdd }) {
  const [rows, setRows] = useState(null);
  const [filing, setFiling] = useState(false);

  const load = useCallback(() => {
    driverExpenses(tripId).then(setRows).catch(() => setRows([]));
  }, [tripId]);
  useEffect(() => { load(); }, [load]);

  const total = (rows || [])
    .filter((r) => r.status !== "rejected")
    .reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="dr-card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 800 }}>Expenses</span>
        <span style={{ fontSize: 13, color: "var(--dr-text-2)" }}>
          {rows == null ? "…" : rows.length === 0 ? "None yet" : peso(total)}
        </span>
      </div>

      {rows?.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.id} className="dr-exp-row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, textTransform: "capitalize" }}>
                  {r.category}
                  {r.hasReceipt && <span className="dr-exp-clip" title="Receipt attached"> 📎</span>}
                </div>
                <div style={{ fontSize: 12, color: "var(--dr-text-2)" }}>
                  {STATUS_TEXT[r.status] || r.status}
                  {r.status === "rejected" && r.reviewNote ? ` — ${r.reviewNote}` : ""}
                </div>
              </div>
              <div style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{peso(r.amount)}</div>
            </div>
          ))}
        </div>
      )}

      {canAdd && (
        <button className="dr-btn" style={{ marginTop: 12 }} onClick={() => setFiling(true)}>
          Add an expense
        </button>
      )}

      {filing && (
        <div className="dr-sheetfull" role="dialog" aria-modal="true" aria-label="Submit a claim">
          <DriverClaimForm
            fixedTrip={{ id: tripId, ticketNo }}
            onBack={() => setFiling(false)}
            onDone={() => { setFiling(false); load(); }}
          />
        </div>
      )}
    </div>
  );
}
