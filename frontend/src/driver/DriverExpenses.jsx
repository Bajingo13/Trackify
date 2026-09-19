import { useCallback, useEffect, useRef, useState } from "react";
import { driverExpenses, driverSubmitExpense } from "./driverApi";
import PhotoPick from "./PhotoPick";

const CATEGORIES = [
  { value: "fuel", label: "Fuel" },
  { value: "toll", label: "Toll" },
  { value: "parking", label: "Parking" },
  { value: "meals", label: "Meals" },
  { value: "lodging", label: "Lodging" },
  { value: "repair", label: "Repair" },
  { value: "misc", label: "Other" },
];

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
 * The photo is optional but strongly encouraged — finance reviews the claim
 * against it. Nothing here posts to the books: every claim goes in as
 * "waiting for review" and only finance can approve it.
 */
export default function DriverExpenses({ tripId, canAdd }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [category, setCategory] = useState("fuel");
  const [amount, setAmount] = useState("");
  const [receiptNo, setReceiptNo] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(() => {
    driverExpenses(tripId).then(setRows).catch(() => setRows([]));
  }, [tripId]);
  useEffect(() => { load(); }, [load]);

  const reset = () => {
    setCategory("fuel"); setAmount(""); setReceiptNo(""); setNote(""); setPhoto(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  async function submit(e) {
    e.preventDefault();
    setErr(""); setOkMsg("");
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) { setErr("Enter how much you spent."); return; }

    const form = new FormData();
    form.set("category", category);
    form.set("amount", String(value));
    if (receiptNo.trim()) form.set("receiptNo", receiptNo.trim());
    if (note.trim()) form.set("description", note.trim());
    if (photo) form.set("receipt", photo);

    setBusy(true);
    try {
      await driverSubmitExpense(tripId, form);
      setOkMsg("Sent for review.");
      reset();
      setOpen(false);
      load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

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

      {okMsg && <div className="dr-ok" style={{ marginTop: 10 }}>{okMsg}</div>}

      {canAdd && !open && (
        <button className="dr-btn" style={{ marginTop: 12 }} onClick={() => { setOpen(true); setOkMsg(""); }}>
          Add an expense
        </button>
      )}

      {canAdd && open && (
        <form onSubmit={submit} style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label className="dr-label">What was it for?</label>
            <div className="dr-chips">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`dr-chip ${category === c.value ? "on" : ""}`}
                  onClick={() => setCategory(c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="dr-label">How much? (₱)</label>
            <input
              className="dr-input"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
            />
          </div>

          <div>
            <label className="dr-label">Receipt / OR number (optional)</label>
            <input className="dr-input" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} placeholder="e.g. OR-12345" />
          </div>

          <div>
            <label className="dr-label">Note (optional)</label>
            <input className="dr-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Diesel top-up, Digos" />
          </div>

          <div>
            <label className="dr-label">Photo of the receipt</label>
            {/* A receipt is usually photographed at the pump, minutes before
                this form is opened — so the gallery matters more here than the
                camera does. */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <PhotoPick
                onFile={setPhoto}
                facing="environment"
                accept="image/*,application/pdf"
                takeLabel={photo ? "Retake" : "Take photo"}
                pickLabel="From gallery"
              />
            </div>
            <div style={{ fontSize: 12, color: "var(--dr-text-2)", marginTop: 4 }}>
              {photo ? photo.name : "Finance checks your claim against this."}
            </div>
          </div>

          {err && <div className="dr-err">{err}</div>}

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="dr-btn ghost" onClick={() => { setOpen(false); setErr(""); reset(); }}>
              Cancel
            </button>
            <button type="submit" className="dr-btn ok" disabled={busy}>
              {busy ? "Sending…" : "Send for review"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
