import { useCallback, useEffect, useMemo, useState } from "react";
import { Info, KeyRound, RefreshCw, ShieldOff, ShieldCheck } from "lucide-react";
import { Button } from "../../../components/ui";
import { Modal, Field } from "../../../components/shared/crud";
import { useToast } from "../../../components/shared/Toast";
import {
  SettingsPage, SettingsToolbar, SearchInput, SettingsTable, ConfirmDialog,
} from "../../../components/settings";
import LicenseCard from "../../../components/license/LicenseCard";
import LicenseBadge from "../../../components/license/LicenseBadge";
import { LICENSE_STATES, describeExpiry, reminderParts } from "../../../components/license/licenseDisplay";
import {
  getMyLicense, listLicenses, renewLicense, revokeLicense, reinstateLicense,
} from "../../../services/admin/licenseService";
import { usePermissions } from "../../../auth/permissions";

/*
 * License: what the client you are working in is licensed for, in plain view.
 * Everyone who can read the company sees its license number, status and end
 * date. A System Administrator also gets every client's license in one table,
 * with renew / revoke / reinstate beside each.
 */

const RENEW_MONTHS = 12;

const FILTERS = [
  ["all", "All"], ["active", "Active"], ["expiring", "Expiring soon"], ["expired", "Expired"], ["revoked", "Revoked"],
];

const sectionTitle = { margin: 0, fontSize: "var(--fs-14)", fontWeight: 700, color: "var(--text)" };
const sectionNote = { margin: "3px 0 0", fontSize: "var(--fs-12)", color: "var(--text-3)" };

/** The reminder column: what was sent on the first line, when and to whom under it. */
function ReminderCell({ row }) {
  const r = reminderParts(row);
  if (!r) return <span style={{ color: "var(--text-3)" }}>—</span>;
  if (r.kind !== "sent") {
    return (
      <span style={{ color: r.kind === "pending" ? "var(--warn)" : "var(--text-2)", fontWeight: r.kind === "pending" ? 600 : 400 }}>
        {r.label}
      </span>
    );
  }
  return (
    <div>
      <div style={{ fontWeight: 600, color: "var(--text)" }}>{r.label}</div>
      <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>{r.when}{r.to ? ` · ${r.to}` : ""}</div>
    </div>
  );
}

export default function LicensePage() {
  const { isSystemAdmin } = usePermissions();
  const { addToast } = useToast();

  const [mine, setMine] = useState(null);
  const [mineError, setMineError] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [confirm, setConfirm] = useState(null); // { mode: 'renew'|'revoke'|'reinstate', row }
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMineError(null);
    try {
      setMine(await getMyLicense());
    } catch (err) {
      setMineError(err.message || "Could not load the license.");
    }
    if (isSystemAdmin) {
      try {
        setRows(await listLicenses());
      } catch (err) {
        setError(err.message || "Could not load client licenses.");
      }
    }
    setLoading(false);
  }, [isSystemAdmin]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const out = { all: rows.length, active: 0, expiring: 0, expired: 0, revoked: 0 };
    for (const r of rows) if (r.state in out) out[r.state] += 1;
    return out;
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (stateFilter !== "all" && r.state !== stateFilter) return false;
      if (!q) return true;
      return [r.companyName, r.companyCode, r.licenseNumber].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [rows, search, stateFilter]);

  async function apply() {
    const { mode, row } = confirm;
    setBusy(true);
    try {
      if (mode === "renew") await renewLicense(row.companyId, RENEW_MONTHS);
      else if (mode === "revoke") await revokeLicense(row.companyId, reason);
      else await reinstateLicense(row.companyId);
      addToast({ renew: "License renewed", revoke: "License revoked", reinstate: "License reinstated" }[mode], "success");
      setConfirm(null);
      setReason("");
      load();
    } catch (err) {
      addToast(err.message || "Update failed", "error");
    } finally {
      setBusy(false);
    }
  }

  function ask(mode, row) {
    setReason("");
    setConfirm({ mode, row });
  }

  return (
    <SettingsPage
      eyebrow="Organization"
      title="License"
      description="The license that lets this client use Trackify — its number, status and end date."
    >
      <div style={{ display: "grid", gap: 32 }}>
        {(mine || mineError) && (
          <section aria-label="Current license" style={{ display: "grid", gap: 12 }}>
            {mine && <LicenseCard license={mine} />}
            {!mine && mineError && <p role="alert" style={{ margin: 0, color: "var(--danger)" }}>{mineError}</p>}
            {mine && !mine.enforced && mine.state !== "missing" && isSystemAdmin && (
              <div
                style={{
                  display: "flex", gap: 10, alignItems: "flex-start", maxWidth: 820, padding: "10px 14px",
                  borderRadius: "var(--r-md)", background: "var(--info-soft)", border: "1px solid var(--info-line)",
                  fontSize: "var(--fs-12)", lineHeight: 1.5, color: "var(--text-2)",
                }}
              >
                <Info size={15} aria-hidden="true" style={{ color: "var(--info)", flexShrink: 0, marginTop: 1 }} />
                <span>
                  License checks are currently tracking only: an expired or revoked license is shown but does not block sign-in.
                  Set LICENSE_ENFORCEMENT=on on the server to enforce it.
                </span>
              </div>
            )}
          </section>
        )}

        {isSystemAdmin && (
          <section aria-labelledby="all-licenses-title">
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
              <div>
                <h3 id="all-licenses-title" style={sectionTitle}>All client licenses</h3>
                <p style={sectionNote}>Every client's license. Renewing adds a year to what is left.</p>
              </div>
              {!loading && !error && (
                <span style={{ fontSize: "var(--fs-12)", color: "var(--text-2)" }}>
                  {visible.length === rows.length
                    ? `${rows.length} license${rows.length === 1 ? "" : "s"}`
                    : `${visible.length} of ${rows.length} licenses`}
                </span>
              )}
            </div>

            <SettingsToolbar right={<SearchInput value={search} onChange={setSearch} placeholder="Search client or license number…" />}>
              <div role="group" aria-label="Filter by license status" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {FILTERS.map(([key, label]) => {
                  const on = stateFilter === key;
                  const dot = LICENSE_STATES[key]?.color;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setStateFilter(key)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: "var(--r-pill)",
                        fontSize: "var(--fs-12)", fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                        color: on ? "var(--accent-ink)" : "var(--text-2)",
                        background: on ? "var(--accent-soft)" : "var(--surface)",
                        border: `1px solid ${on ? "var(--accent-line)" : "var(--line)"}`,
                      }}
                    >
                      {dot && <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} />}
                      {label}{" "}
                      <span
                        style={{
                          minWidth: 18, padding: "0 5px", borderRadius: "var(--r-pill)", textAlign: "center", fontSize: 11, fontWeight: 700,
                          color: on ? "var(--accent-ink)" : "var(--text-3)", background: on ? "var(--surface)" : "var(--surface-sunk)",
                        }}
                      >
                        {counts[key]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </SettingsToolbar>

            <SettingsTable
              columns={[
                { key: "client", label: "Client" },
                { key: "number", label: "License number" },
                { key: "status", label: "Status" },
                { key: "reminder", label: "Last reminder" },
                { key: "actions", label: "Actions", align: "right" },
              ]}
              rows={visible}
              loading={loading}
              error={error}
              onRetry={load}
              empty={{ icon: KeyRound, title: "No licenses found", hint: search || stateFilter !== "all" ? "Try a different filter or search." : undefined }}
              renderRow={(row) => (
                <tr key={row.licenseId}>
                  <td>
                    <div style={{ fontWeight: 600, color: "var(--text)" }}>{row.companyName}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>{row.companyCode}</div>
                  </td>
                  <td>
                    <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "nowrap", userSelect: "all" }}>{row.licenseNumber}</code>
                  </td>
                  <td>
                    <LicenseBadge state={row.state} size="sm" />
                    {row.state !== "revoked" && (
                      <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--text-2)" }}>{describeExpiry(row)}</div>
                    )}
                  </td>
                  <td style={{ fontSize: 12.5 }}><ReminderCell row={row} /></td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {!row.perpetual && row.status !== "revoked" && (
                        <Button variant="secondary" size="sm" icon={RefreshCw} aria-label={`Renew ${row.companyName}`} onClick={() => ask("renew", row)}>
                          Renew
                        </Button>
                      )}
                      {row.status === "revoked" ? (
                        <Button variant="ghost" size="sm" icon={ShieldCheck} title="Reinstate" aria-label={`Reinstate ${row.companyName}`} onClick={() => ask("reinstate", row)} />
                      ) : (
                        <Button variant="ghost" size="sm" icon={ShieldOff} title="Revoke" aria-label={`Revoke ${row.companyName}`} onClick={() => ask("revoke", row)} />
                      )}
                    </div>
                  </td>
                </tr>
              )}
            />
          </section>
        )}
      </div>

      {confirm?.mode === "renew" && (
        <ConfirmDialog
          title="Renew license?"
          message={`${confirm.row.companyName}'s license will be extended by one year, counted from its current end date (or today, if it has lapsed).`}
          confirmLabel="Renew for 1 year"
          loading={busy}
          onConfirm={apply}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm?.mode === "reinstate" && (
        <ConfirmDialog
          title="Reinstate license?"
          message={`${confirm.row.companyName} will be able to use Trackify again until the license end date.`}
          confirmLabel="Reinstate"
          loading={busy}
          onConfirm={apply}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm?.mode === "revoke" && (
        <Modal softBackdrop title="Revoke license?" onClose={() => !busy && setConfirm(null)}>
          <p style={{ margin: "0 0 16px", color: "var(--text-2)", fontSize: 13, lineHeight: 1.55 }}>
            With enforcement on, <strong>{confirm.row.companyName}</strong> will lose access straight away. The reason is kept with the license and in the audit log.
          </p>
          <Field label="Revocation reason *" hint="10–500 characters">
            <textarea
              className="ops-form-input"
              rows={4}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explain why this license is being revoked"
            />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" loading={busy} disabled={reason.trim().length < 10} onClick={apply}>Revoke license</Button>
          </div>
        </Modal>
      )}
    </SettingsPage>
  );
}
